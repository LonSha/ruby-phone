/** Read only the album owner's filtered public media, with a readable vault boundary. */
export function publicExperiencePhotos(storage) {
    try {
        const album = globalThis.window?.VirtualPhone?.albumApp?.albumData;
        if (!album || album.storage !== storage || typeof album.getMedia !== 'function' || !album.vaultFace?.().readable) return [];
        return album.getMedia().filter(row => row && row.mediaType === 'image' && typeof row.id === 'string').map(row => ({ref:'photo:'+row.id,title:String(row.filename || '照片'),text:String(row.filename || '照片'),attachment:'未打包图片附件'}));
    } catch (_) { return []; }
}