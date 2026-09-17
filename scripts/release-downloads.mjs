// Счётчик скачиваний установщика из GitHub Releases. Запускается разработчиком,
// не входит в браузер и не отправляет из него никаких событий.
import { pathToFileURL } from 'node:url';

const REPO = 'radiypoloniy/oblachka-browser';
const API = `https://api.github.com/repos/${REPO}/releases`;
const INSTALLER = /^Oblako-Setup-.*\.exe$/i;

export function summarizeReleases(releases) {
  const rows = [];
  for (const release of releases) {
    if (release.draft) continue;
    const assets = (release.assets ?? []).filter((asset) => INSTALLER.test(asset.name ?? ''));
    if (assets.length === 0) continue;
    rows.push({
      tag: release.tag_name,
      downloads: assets.reduce((sum, asset) => sum + (Number(asset.download_count) || 0), 0),
      assets: assets.map((asset) => asset.name),
    });
  }
  return { rows, total: rows.reduce((sum, row) => sum + row.downloads, 0) };
}

export async function fetchReleases(fetcher = fetch, token = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN) {
  const releases = [];
  for (let page = 1; ; page++) {
    const headers = {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'oblako-release-downloads',
      'X-GitHub-Api-Version': '2022-11-28',
    };
    if (token) headers.Authorization = `Bearer ${token}`;
    const response = await fetcher(`${API}?per_page=100&page=${page}`, { headers });
    if (!response.ok) {
      throw new Error(`GitHub API: HTTP ${response.status}${response.status === 404 ? ' (репозиторий может быть приватным; укажите GITHUB_TOKEN)' : ''}`);
    }
    const batch = await response.json();
    if (!Array.isArray(batch)) throw new Error('GitHub API вернул неожиданный формат релизов');
    releases.push(...batch);
    if (batch.length < 100) return releases;
  }
}

async function main() {
  const { rows, total } = summarizeReleases(await fetchReleases());
  if (rows.length === 0) {
    console.log('Опубликованных Oblako-Setup-*.exe в GitHub Releases пока нет.');
    return;
  }
  for (const row of rows) console.log(`${row.tag}: ${row.downloads} скачиваний установщика`);
  console.log(`Всего: ${total}`);
  console.log('Это скачивания файлов, не уникальные люди и не успешные установки.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
