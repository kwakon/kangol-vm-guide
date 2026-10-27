(() => {
 const load=src=>new Promise((resolve,reject)=>{const s=document.createElement('script');s.src=src;s.onload=resolve;s.onerror=()=>reject(new Error(src));document.head.appendChild(s);});
 (async()=>{try{
  await load('./core.js');
  const edition=window.VMCore.editionFromURL(location.href,window.VM_GUIDE_CATALOG);window.VM_ACTIVE_EDITION=edition;
  await load('./data/media-sizes.js');await load('./data/schedule-notices.js');
  await load(`./data/editions/${edition.id}/web-content.js`);
  await load(`./data/editions/${edition.id}/comments.js`);
  if(window.VM_WEB_CONTENT?.edition?.id!==edition.id||window.VM_COMMENTS?.editionId!==edition.id)throw new Error('차수 데이터가 일치하지 않습니다.');
  await load('./app.js');
 }catch(error){const p=document.createElement('p');p.className='loading-message';p.textContent='가이드 데이터를 불러오지 못했습니다. 파일과 차수 설정을 확인해 주세요.';document.querySelector('#guide').replaceChildren(p);console.error(error);}})();
})();
