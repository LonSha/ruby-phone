import { publicExperiencePhotos } from './experience-media.js';
import { buildShareDraft, previewRecipientView } from './sharing-boundary.js';
export function experienceSources(storage) {
    const rows=[];
    for(const [key,kind] of [['calendar_memos','calendar']]) {
        try {const raw=storage.get(key); const list=typeof raw==='string'?JSON.parse(raw):raw;if(!Array.isArray(list))continue;
            for(const item of list) {if(!item?.id||item.secret||item.private||item.hidden)continue; const text=String(item.title||item.caption||item.description||'');if(text)rows.push({ref:kind+':'+item.id,title:text,text,attachment:kind==='photo'?'未打包图片附件':'无附件'});}
        }catch(_){}
    }
    try {const raw=storage.get('pixiv_content'); const content=typeof raw==='string'?JSON.parse(raw):raw;for(const work of content?.novels||[]){if(!work?.id||work.secret||work.private||work.hidden)continue;rows.push({ref:'work:'+work.id,title:String(work.title||work.id),text:String(work.title||''),attachment:'仅作品标题，不含章节或嵌套引用'});}}catch(_){}
    const owner=globalThis.window?.VirtualPhone?.wechatApp?.wechatData;
    if(owner?.storage===storage)for(const chat of owner.data?.chats||[]) {
        if(!owner._messagesLoaded?.[chat.id])continue;
        for(const message of owner.data.messages?.[chat.id]||[]) {
            if(!message?.id||message.type!=='text'||message.secret||message.private||message.hiddenFromPreview||message.isTimeMarker)continue;
            rows.push({ref:'message:'+chat.id+':'+message.id,title:String(chat.name||chat.id)+' · '+String(message.content||'').slice(0,40),text:String(message.content||'').slice(0,8000),attachment:'无附件'});
        }
    }
    rows.push(...publicExperiencePhotos(storage));
    return rows.filter((row,index)=>rows.findIndex(r=>r.ref===row.ref)===index);
}
export function buildExperiencePack(title, recipient, selected, sources) {
    if(typeof title!=='string'||!title.trim()||title.length>80||typeof recipient!=='string'||!recipient.trim()||!Array.isArray(selected)||!selected.length||selected.length>24||new Set(selected).size!==selected.length) return {ok:false,reason:'请填写名称、接收人并选择1–24项'};
    const items=[];
    for(const ref of selected) {const matches=sources.filter(row=>row.ref===ref);if(matches.length!==1)return {ok:false,reason:'来源已缺失或身份重复'};const source=matches[0];const draft=buildShareDraft({snippet:source.text,recipients:[recipient.trim()],reshareable:false});const visible=previewRecipientView(draft,recipient.trim());if(visible.content==null)return {ok:false,reason:'未授权'};items.push({ref,text:visible.content,attachment:source.attachment});}
    return {ok:true,pack:{format:'ruby-experience-v1',title:title.trim(),recipient:recipient.trim(),items}};
}
