(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.VMCore=factory();})(typeof globalThis!=='undefined'?globalThis:this,function(){
 'use strict';
 function parseDate(value){
  if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))throw new Error('날짜는 YYYY-MM-DD 형식이어야 합니다.');
  const [y,m,d]=value.split('-').map(Number);const dt=new Date(Date.UTC(y,m-1,d));
  if(dt.getUTCFullYear()!==y||dt.getUTCMonth()!==m-1||dt.getUTCDate()!==d)throw new Error('유효하지 않은 날짜입니다: '+value);
  return dt;
 }
 const iso=dt=>dt.toISOString().slice(0,10);
 function nextWeekTuesday(value){const dt=parseDate(value);const mondayIndex=(dt.getUTCDay()+6)%7;dt.setUTCDate(dt.getUTCDate()+9-mondayIndex);return iso(dt);}
 function effectiveEvent(event,holidays=[]){
  const blocked=new Set(holidays.map(h=>typeof h==='string'?h:h.date));let share;
  if(event.explicitShareDate){parseDate(event.explicitShareDate);share=event.explicitShareDate;}
  else{const dt=parseDate(event.plannedDate);let guard=0;while([0,6].includes(dt.getUTCDay())||blocked.has(iso(dt))){dt.setUTCDate(dt.getUTCDate()-1);if(++guard>366)throw new Error('공유일 조정 범위를 초과했습니다.');}share=iso(dt);}
  const upload=event.uploadOverride?(parseDate(event.uploadOverride),event.uploadOverride):nextWeekTuesday(share);
  return {...event,shareDate:share,uploadDate:upload,adjusted:!event.explicitShareDate&&share!==event.plannedDate};
 }
 function monthRows(month){
  if(typeof month!=='string'||!/^\d{4}-\d{2}$/.test(month))throw new Error('달력 월 형식이 올바르지 않습니다.');
  const first=parseDate(month+'-01');const last=new Date(Date.UTC(first.getUTCFullYear(),first.getUTCMonth()+1,0)).getUTCDate();const cells=Array(first.getUTCDay()).fill(null);
  for(let d=1;d<=last;d++)cells.push(`${month}-${String(d).padStart(2,'0')}`);while(cells.length%7)cells.push(null);
  const rows=[];for(let i=0;i<cells.length;i+=7)rows.push(cells.slice(i,i+7));return rows;
 }
 function validateComments(input,knownPhotos,edition){
  const allowed=new Set(knownPhotos);if(!input||input.schemaVersion!==1||!Array.isArray(input.entries))throw new Error('지원하는 코멘트 JSON 형식이 아닙니다.');
  if(input.editionId!==edition)throw new Error('현재 차수와 다른 코멘트 파일입니다.');
  const ids=new Set(),numbers=new Set();const entries=input.entries.map(raw=>{
   if(!raw||typeof raw.id!=='string'||!/^[a-zA-Z0-9_-]{1,100}$/.test(raw.id)||ids.has(raw.id))throw new Error('코멘트 ID가 잘못되었거나 중복되었습니다.');ids.add(raw.id);
   if(!allowed.has(raw.photoId))throw new Error('존재하지 않는 사진 ID입니다: '+raw.photoId);
   if(!Number.isInteger(raw.number)||raw.number<1||raw.number>99)throw new Error('번호는 1~99 사이 정수여야 합니다.');
   const key=raw.photoId+':'+raw.number;if(numbers.has(key))throw new Error('같은 사진의 코멘트 번호가 중복되었습니다.');numbers.add(key);
   if(typeof raw.text!=='string'||raw.text.length>6000)throw new Error('코멘트 본문 형식이나 길이가 올바르지 않습니다.');
   if(!Number.isFinite(raw.x)||!Number.isFinite(raw.y)||raw.x<0||raw.x>1||raw.y<0||raw.y>1)throw new Error('마커 좌표는 0~1 사이여야 합니다.');
   if(raw.referencePhotoId&&!allowed.has(raw.referencePhotoId))throw new Error('참고 이미지 ID가 존재하지 않습니다.');
   return {id:raw.id,photoId:raw.photoId,number:raw.number,text:raw.text,x:raw.x,y:raw.y,...(raw.referencePhotoId?{referencePhotoId:raw.referencePhotoId}:{})};
  });return {schemaVersion:1,editionId:edition,entries};
 }
 function commentsFor(document,photoId){return document.entries.filter(c=>c.photoId===photoId&&c.text.trim()).sort((a,b)=>a.number-b.number);}
 function categoryFromURL(url,categories,fallback='key-notes'){
  const parsed=new URL(url,'http://local.invalid');const allowed=new Set(categories.map(c=>typeof c==='string'?c:c.id));const query=parsed.searchParams.get('category');if(allowed.has(query))return query;
  const hash=parsed.hash.replace(/^#\/?/,'');if(allowed.has(hash))return hash;
  const match=hash.match(/^slide-(\d+)$/);if(match){const n=Number(match[1]);const id=n===8?'schedule':n===9?'promotion':n>=10&&n<=13?'key-item':n===14?'panorama':n<=16&&n>=15?'vp':n<=19&&n>=17?'mnq':n<=21&&n>=20?'unisex':n===22?'woman':n<=27&&n>=23?'bag':n===28?'acc':n<=30&&n>=29?'headwear':fallback;return allowed.has(id)?id:fallback;}
  return allowed.has(fallback)?fallback:[...allowed][0];
 }
 function availableEditions(catalog){
  if(!catalog||catalog.schemaVersion!==1||!Array.isArray(catalog.editions))throw new Error('차수 목록 형식을 확인해 주세요.');
  const ids=new Set();const entries=catalog.editions.filter(e=>e.published!==false).map(e=>{
   if(!/^[a-z0-9-]+$/.test(e.id)||ids.has(e.id)||!/^\d{4} (SS|AW)$/.test(e.season)||typeof e.tabLabel!=='string')throw new Error('시즌·차수 목록을 확인해 주세요.');
   ids.add(e.id);parseDate(e.releasedOn);return e;
  });return entries.sort((a,b)=>a.releasedOn.localeCompare(b.releasedOn)||a.id.localeCompare(b.id,undefined,{numeric:true}));
 }
 function latestEdition(catalog,season){const entries=availableEditions(catalog).filter(e=>!season||e.season===season);if(!entries.length)throw new Error('선택할 수 있는 가이드가 없습니다.');return entries[entries.length-1];}
 function editionFromURL(url,catalog){const id=new URL(url,'http://local.invalid').searchParams.get('edition');return availableEditions(catalog).find(e=>e.id===id)||latestEdition(catalog);}
 function photoRows(photoIds,maxColumns=3){
  if(!Array.isArray(photoIds)||!Number.isInteger(maxColumns)||maxColumns<1)throw new Error('사진 목록과 열 수를 확인해 주세요.');
  if(!photoIds.length)return [];const count=Math.ceil(photoIds.length/maxColumns),base=Math.floor(photoIds.length/count),remainder=photoIds.length%count;let offset=0;
  return Array.from({length:count},(_,i)=>{const size=base+(i<remainder?1:0),row=photoIds.slice(offset,offset+size);offset+=size;return row;});
 }
 function shareLabels(events,label){const counts={},labels={};for(const e of [...events].sort((a,b)=>a.shareDate.localeCompare(b.shareDate)||a.id.localeCompare(b.id))){const month=e.shareDate.slice(0,7);counts[month]=(counts[month]||0)+1;labels[e.id]=(e.guideSequence||counts[month])+'차 '+label;}return labels;}
 function galleryRows(items){
  if(!Array.isArray(items)||items.some(item=>!item||!Number.isFinite(item.ratio)||item.ratio<=0))throw new Error('사진 비율을 확인해 주세요.');
  const rows=[];let offset=0;while(offset<items.length){const next=items.slice(offset,offset+3),mean=next.reduce((sum,p)=>sum+p.ratio,0)/next.length;let count=Math.min(mean>=1.15||next.some(p=>p.ratio>=1.25)?2:3,items.length-offset);if(count===3&&items.length-offset-count===1)count=2;rows.push(items.slice(offset,offset+count));offset+=count;}return rows;
 }
 function scheduleNotice(data,editionId){
  const notice=data?.guides?.[editionId];if(!notice)return '';parseDate(notice.shareDate);parseDate(notice.uploadDate);
  if(typeof notice.template!=='string')throw new Error('일정 안내 문구를 확인해 주세요.');
  const short=value=>value.slice(5).replace('-','/');return notice.template.replace(/\{share\}/g,short(notice.shareDate)).replace(/\{upload\}/g,short(notice.uploadDate));
 }
 function mnqScale(height,viewportHeight,headerHeight,toolsHeight,titleHeight,desktop){
  if(!Number.isFinite(height)||height<=0)return .9;if(!desktop)return .9;
  const available=Math.max(240,viewportHeight-headerHeight-toolsHeight-titleHeight-80);return Math.min(.9,Math.max(.4,available/height));
 }
 function thirdFriday(month){const dt=parseDate(month+'-01');dt.setUTCDate(1+(5-dt.getUTCDay()+7)%7+14);return iso(dt);}
 function safeAsset(path){return typeof path==='string'&&/^assets\/[a-zA-Z0-9_./-]+$/.test(path)&&!path.split('/').includes('..');}
 return {parseDate,iso,nextWeekTuesday,effectiveEvent,monthRows,validateComments,commentsFor,categoryFromURL,safeAsset,availableEditions,latestEdition,editionFromURL,photoRows,shareLabels,galleryRows,scheduleNotice,mnqScale,thirdFriday};
});
