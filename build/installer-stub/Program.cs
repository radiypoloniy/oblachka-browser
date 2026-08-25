using System.Diagnostics;
using System.Globalization;
using System.Reflection;
using System.Runtime.InteropServices;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace OblakoSetupUi;

static class Program
{
    [STAThread]
    static void Main(string[] args)
    {
        Application.SetHighDpiMode(HighDpiMode.PerMonitorV2);
        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);

        // ⚠️ Окно установки НИКОГДА не должно показывать штатный диалог .NET «Unhandled exception»:
        // файлы в это время копирует молчащий NSIS, и английская ошибка поверх карточки читается
        // как «установка сломалась», хотя она идёт. Пишем в лог рядом с состоянием и живём дальше.
        Application.SetUnhandledExceptionMode(UnhandledExceptionMode.CatchException);
        Application.ThreadException += (_, e) => Log(e.Exception);
        AppDomain.CurrentDomain.UnhandledException += (_, e) => Log(e.ExceptionObject as Exception);

        string? statePath = null;
        int parentPid = 0;
        for (var i = 0; i < args.Length; i++)
        {
            if (args[i] == "--state" && i + 1 < args.Length) statePath = args[++i];
            else if (args[i] == "--pid" && i + 1 < args.Length)
                int.TryParse(args[++i], NumberStyles.Integer, CultureInfo.InvariantCulture, out parentPid);
        }

        Application.Run(new SetupForm(statePath, parentPid));
    }

    internal static void Log(Exception? ex)
    {
        if (ex == null) return;
        try
        {
            File.AppendAllText(
                Path.Combine(Path.GetTempPath(), "oblako-setup-ui.log"),
                $"{DateTime.Now:O} {ex}{Environment.NewLine}");
        }
        catch { /* лог — не причина падать второй раз */ }
    }
}

sealed class SetupForm : Form
{
    readonly string? statePath;
    readonly int parentPid;
    readonly WebView2 web = new() { Dock = DockStyle.Fill, Visible = false };

    // ⚠️ Окно установки не имеет права быть пустым: человек видит его ВМЕСТО мастера Windows и по
    // пустоте читает «установка сломалась». Поэтому под карточкой всегда лежит текстовая
    // заглушка — она же остаётся, если WebView2 на машине не поднялся.
    readonly Label fallback = new()
    {
        Dock = DockStyle.Fill,
        TextAlign = ContentAlignment.MiddleCenter,
        Font = new Font("Segoe UI", 12F),
        ForeColor = Color.FromArgb(20, 20, 15),
        Text = "Устанавливаем Oblako…",
    };
    System.Windows.Forms.Timer? poll;
    string? appExe;
    bool finished;

    public SetupForm(string? statePath, int parentPid)
    {
        this.statePath = statePath;
        this.parentPid = parentPid;
        Text = "Oblako";
        FormBorderStyle = FormBorderStyle.None;
        StartPosition = FormStartPosition.CenterScreen;
        Size = new Size(720, 360);
        MinimumSize = Size;
        MaximumSize = Size;
        ShowInTaskbar = true;
        BackColor = Color.FromArgb(247, 243, 234);
        Controls.Add(web);
        Controls.Add(fallback);
        Load += async (_, _) =>
        {
            RoundCorners();
            await StartWebAsync();
            poll = new System.Windows.Forms.Timer { Interval = 250 };
            poll.Tick += (_, _) => Tick();
            poll.Start();
        };
        FormClosed += (_, _) => poll?.Stop();
    }

    async Task StartWebAsync()
    {
        var root = ExtractUi();
        var envDir = Path.Combine(Path.GetTempPath(), "oblako-setup-ui-wv2");
        Directory.CreateDirectory(envDir);
        try
        {
            var env = await CoreWebView2Environment.CreateAsync(null, envDir);
            await web.EnsureCoreWebView2Async(env);
        }
        catch (Exception ex)
        {
            // Нет WebView2 — остаётся заглушка тех же цветов, установка NSIS всё равно идёт.
            // ⚠️ Молча глотать это нельзя: ровно так пропажа WebView2Loader.dll из single-file
            // выглядела как «просто пустое окно» и стоила отдельного разбора.
            Program.Log(ex);
            return;
        }
        web.CoreWebView2.Settings.AreDefaultContextMenusEnabled = false;
        web.CoreWebView2.Settings.AreDevToolsEnabled = false;
        web.CoreWebView2.Settings.IsStatusBarEnabled = false;
        web.CoreWebView2.WebMessageReceived += (_, e) =>
        {
            var msg = e.TryGetWebMessageAsString();
            if (msg == "cancel") CancelInstall();
            else if (msg == "open") OpenApp();
            else if (msg == "close") Close();
        };
        // Показываем карточку только когда она отрисована — иначе видно белый прямоугольник WebView2.
        web.CoreWebView2.NavigationCompleted += (_, _) =>
        {
            fallback.Visible = false;
            web.Visible = true;
        };
        web.CoreWebView2.Navigate(new Uri(Path.Combine(root, "index.html")).AbsoluteUri);
    }

    void Tick()
    {
        if (finished) return;
        if (!string.IsNullOrEmpty(statePath) && File.Exists(statePath))
        {
            string text;
            try { text = File.ReadAllText(statePath); }
            catch { return; }
            var lines = text.Split(['\r', '\n'], StringSplitOptions.RemoveEmptyEntries);
            if (lines.Length > 0 && lines[0].Equals("done", StringComparison.OrdinalIgnoreCase))
            {
                if (lines.Length > 1) appExe = lines[1].Trim();
                Finish("done");
                return;
            }
            if (lines.Length > 0 && lines[0].Equals("error", StringComparison.OrdinalIgnoreCase))
            {
                Finish("error");
                return;
            }
        }
        if (parentPid > 0 && !IsProcessAlive(parentPid) && !finished)
            Finish("error");
    }

    void Finish(string screen)
    {
        finished = true;
        poll?.Stop();
        if (web.CoreWebView2 == null)
        {
            // Карточки нет — кнопок «Открыть»/«Закрыть» человеку не показать, поэтому решаем за него:
            // на успехе ведём себя как runAfterFinish, на ошибке говорим словом и уходим.
            if (screen == "done") { OpenApp(); return; }
            fallback.Text = "Установка не завершилась." + Environment.NewLine
                + "Попробуйте запустить установщик ещё раз.";
            var bye = new System.Windows.Forms.Timer { Interval = 5000 };
            bye.Tick += (_, _) => { bye.Stop(); Close(); };
            bye.Start();
            return;
        }
        PostScreen(screen);
    }

    void PostScreen(string screen)
    {
        if (web.CoreWebView2 == null) return;
        web.CoreWebView2.PostWebMessageAsString($"{{\"screen\":\"{screen}\"}}");
    }

    void CancelInstall()
    {
        if (parentPid > 0)
        {
            try
            {
                using var p = Process.GetProcessById(parentPid);
                p.Kill(entireProcessTree: true);
            }
            catch { /* уже вышел */ }
        }
        Close();
    }

    void OpenApp()
    {
        var exe = appExe;
        if (string.IsNullOrWhiteSpace(exe) || !File.Exists(exe))
        {
            // Запасной путь на случай, если состояние не донесло адрес: NSIS ставит нас в папку по
            // имени пакета (oblako-browser), но витринное имя — Oblako, поэтому проверяем оба.
            var programs = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Programs");
            foreach (var dir in new[] { "oblako-browser", "Oblako" })
            {
                var guess = Path.Combine(programs, dir, "Oblako.exe");
                if (File.Exists(guess)) { exe = guess; break; }
            }
        }
        if (!string.IsNullOrWhiteSpace(exe) && File.Exists(exe))
        {
            Process.Start(new ProcessStartInfo(exe) { UseShellExecute = true });
        }
        Close();
    }

    static bool IsProcessAlive(int pid)
    {
        try
        {
            using var p = Process.GetProcessById(pid);
            return !p.HasExited;
        }
        catch { return false; }
    }

    static string ExtractUi()
    {
        var dir = Path.Combine(Path.GetTempPath(), "oblako-setup-ui");
        Directory.CreateDirectory(Path.Combine(dir, "fonts"));
        var asm = Assembly.GetExecutingAssembly();
        foreach (var name in asm.GetManifestResourceNames())
        {
            using var src = asm.GetManifestResourceStream(name);
            if (src == null) continue;
            string dest;
            var key = name.Replace('\\', '/');
            if (key.EndsWith("index.html", StringComparison.Ordinal))
                dest = Path.Combine(dir, "index.html");
            else if (key.EndsWith(".woff2", StringComparison.OrdinalIgnoreCase))
                dest = Path.Combine(dir, "fonts", Path.GetFileName(key));
            else continue;
            Directory.CreateDirectory(Path.GetDirectoryName(dest)!);
            using var dst = File.Create(dest);
            src.CopyTo(dst);
        }
        return dir;
    }

    void RoundCorners()
    {
        try
        {
            var pref = 2; // DWMWCP_ROUND
            _ = DwmSetWindowAttribute(Handle, 33, ref pref, sizeof(int));
        }
        catch { /* Windows 10 без округления — прямоугольник, это терпимо */ }
    }

    [DllImport("dwmapi.dll")]
    static extern int DwmSetWindowAttribute(IntPtr hwnd, int attr, ref int pv, int cb);
}
