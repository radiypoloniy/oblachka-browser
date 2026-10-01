// Сеть и настоящий DOM WB: отдельный ручной прогон, не часть npm test.
import assert from 'node:assert/strict';
import { withStand, wait } from './isolated-stand.mjs';

await withStand(async ctx => {
  for (const article of ['86035817', '87058345']) {
    const url=`https://www.wildberries.ru/catalog/${article}/detail.aspx`;
    const id=await ctx.chrome.evaluate(`window.oblako.createTab(${JSON.stringify(url)})`);
    await wait(15000);
    const result=await ctx.evalMain(`(async()=>{
      const req=process.mainModule.require,root=req('electron').app.getAppPath(),mod=n=>req(req('path').join(root,'dist-electron/electron',n));
      const tabs=mod('WindowRegistry.js').mainContext().tabs,wc=tabs.getWebContentsForTab(${JSON.stringify(id)});
      tabs.createSpecialTab('compare');
      const product=await mod('compare/CompareWb.js').readExpandedCompareProduct(wc,${JSON.stringify(id)});
      tabs.activate(${JSON.stringify(id)});
      await new Promise(resolve=>setTimeout(resolve,800));
      return {product,dialogOpen:await wc.executeJavaScript('!!document.querySelector("[data-testid=product_additional_information]")'),diagnostic:await wc.executeJavaScript('(()=>{const e=document.querySelector("[data-testid=product_additional_information]");return e?{parents:[e.parentElement,e.parentElement?.parentElement,e.closest("[role=dialog]")].map(p=>p?.outerHTML.slice(0,1200)),buttons:[...document.querySelectorAll("[role=dialog] button")].map(b=>b.outerHTML.slice(0,500))}:null})()')};
    })()`);
    assert.ok(result.product?.facts.length>=10,'Характеристики прочитаны в скрытой вкладке');
    if(result.dialogOpen)console.log(JSON.stringify(result.diagnostic));
    assert.equal(result.dialogOpen,false,'Открытый браузером drawer закрыт');
    const price=result.product.facts.filter(f=>/цен/i.test(f.label));
    assert.ok(!price.some(f=>/другого продавца/i.test(f.value)));
    console.log('ok WB',article,result.product.title,result.product.facts.length,'характеристик; цена:',price.map(f=>f.value));
  }
}, {main:true});
