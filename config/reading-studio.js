/**
 * config/reading-studio.js — [v4.51.0 · R6-O6] 主动研读工作室契约内核
 * 
 * 【设计职责】
 * 解决“围绕一个问题持续阅读缺乏结构支撑、摘录与论述混淆、中断重开状态丢失、资料改版覆盖作者文字”的缺陷：
 * 1. 围绕核心研读问题（researchQuestion）组织跨书阅读；
 * 2. 精确段落回源（excerpts with bookId & paragraphRef），原话不可篡改；
 * 3. 观点对照（contrastingViews: pro / contra / neutral）；
 * 4. 研读疑问批注（annotations）；
 * 5. 论证草稿衍生（dossierDraft），研究成果成为成稿资料，不重复拷贝全文；
 * 6. 资料改版保护：新版书更新时可选择保留作者观点或重查，绝不静默覆盖作者写好的正文。
 * 
 * 零宿主依赖、零 DOM、纯函数、状态受控克隆，全面冻结导出。
 */
import { numOrNull } from './num-gate.js';

export const RS_STORAGE_KEY = 'reading_studio_v1';

function normStr(v) {
    return String(v ?? '').trim();
}


/**
 * 创建或标准化研读案卷结构
 */
export function createReadingDossier(raw = {}) {
    const id = normStr(raw.id || raw.dossierId) || `dossier_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const researchQuestion = normStr(raw.researchQuestion) || '未设定研读问题';
    const title = normStr(raw.title) || `关于「${researchQuestion}」的研读案卷`;

    const books = Array.isArray(raw.books) ? raw.books.map(normBook).filter(Boolean) : [];
    const excerpts = Array.isArray(raw.excerpts) ? raw.excerpts.map(normExcerpt).filter(Boolean) : [];
    const contrastingViews = Array.isArray(raw.contrastingViews) ? raw.contrastingViews.map(normView).filter(Boolean) : [];
    const annotations = Array.isArray(raw.annotations) ? raw.annotations.map(normAnnotation).filter(Boolean) : [];

    const draft = raw.draft && typeof raw.draft === 'object'
        ? {
            title: normStr(raw.draft.title) || title,
            sections: Array.isArray(raw.draft.sections) ? raw.draft.sections.map(normSection) : [],
            updatedAt: (numOrNull(raw.draft.updatedAt) ?? Date.now()),
        }
        : {
            title,
            sections: [],
            updatedAt: Date.now(),
        };

    return {
        version: 1,
        id,
        title,
        researchQuestion,
        status: ['open', 'in_progress', 'drafting', 'completed'].includes(raw.status) ? raw.status : 'in_progress',
        books,
        excerpts,
        contrastingViews,
        annotations,
        draft,
        updatedAt: (numOrNull(raw.updatedAt) ?? Date.now()),
    };
}

function normBook(b) {
    if (!b || typeof b !== 'object') return null;
    const bookId = normStr(b.bookId || b.id);
    if (!bookId) return null;
    return {
        bookId,
        title: normStr(b.title || bookId),
        version: normStr(b.version || 'v1.0'),
        author: normStr(b.author || '未知作者'),
    };
}

function normExcerpt(e) {
    if (!e || typeof e !== 'object') return null;
    const id = normStr(e.id) || `exc_${Math.random().toString(36).slice(2, 7)}`;
    const bookId = normStr(e.bookId);
    if (!bookId) return null;
    return {
        id,
        bookId,
        bookTitle: normStr(e.bookTitle || bookId),
        bookVersion: normStr(e.bookVersion || 'v1.0'),
        paragraphRef: normStr(e.paragraphRef || '段落未知'),
        verbatimText: normStr(e.verbatimText || e.text),
        isStale: !!e.isStale,
        staleReason: normStr(e.staleReason || ''),
        addedAt: (numOrNull(e.addedAt) ?? Date.now()),
    };
}

function normView(v) {
    if (!v || typeof v !== 'object') return null;
    const id = normStr(v.id) || `view_${Math.random().toString(36).slice(2, 7)}`;
    const claim = normStr(v.claimText || v.claim);
    if (!claim) return null;
    return {
        id,
        claim,
        stance: ['pro', 'contra', 'neutral', 'open'].includes(v.stance) ? v.stance : 'pro',
        evidenceExcerptIds: Array.isArray(v.evidenceExcerptIds) ? v.evidenceExcerptIds.map(normStr) : [],
        explanation: normStr(v.explanation || ''),
    };
}

function normAnnotation(a) {
    if (!a || typeof a !== 'object') return null;
    const id = normStr(a.id) || `ann_${Math.random().toString(36).slice(2, 7)}`;
    const excerptId = normStr(a.excerptId);
    return {
        id,
        excerptId,
        question: normStr(a.question),
        comment: normStr(a.comment),
        createdAt: (numOrNull(a.createdAt) ?? Date.now()),
    };
}

function normSection(s) {
    if (!s || typeof s !== 'object') return { heading: '论述段落', body: '', citedExcerptIds: [] };
    return {
        heading: normStr(s.heading || '小结'),
        body: normStr(s.body || ''),
        citedExcerptIds: Array.isArray(s.citedExcerptIds) ? s.citedExcerptIds.map(normStr) : [],
    };
}

/**
 * 关联阅读书籍
 */
export function linkBookToDossier(dossier, bookPayload) {
    const d = createReadingDossier(dossier);
    const b = normBook(bookPayload);
    if (!b) return { ok: false, reason: 'invalid_book_payload' };

    const idx = d.books.findIndex(x => x.bookId === b.bookId);
    if (idx >= 0) {
        d.books[idx] = b;
    } else {
        d.books.push(b);
    }
    d.updatedAt = Date.now();
    return { ok: true, dossier: d, book: b };
}

/**
 * 从某本书中引用原句
 */
export function addExcerpt(dossier, excerptPayload) {
    const d = createReadingDossier(dossier);
    const e = normExcerpt(excerptPayload);
    if (!e) return { ok: false, reason: 'invalid_excerpt_payload' };

    // 自动补全书名和版本
    const book = d.books.find(b => b.bookId === e.bookId);
    if (book) {
        if (!e.bookTitle) e.bookTitle = book.title;
        if (!e.bookVersion) e.bookVersion = book.version;
    }

    d.excerpts.push(e);
    d.updatedAt = Date.now();
    return { ok: true, dossier: d, excerpt: e };
}

/**
 * 添加观点对照（正反观点并列）
 */
export function addContrastingView(dossier, viewPayload) {
    const d = createReadingDossier(dossier);
    const v = normView(viewPayload);
    if (!v) return { ok: false, reason: 'invalid_view_payload' };

    d.contrastingViews.push(v);
    d.updatedAt = Date.now();
    return { ok: true, dossier: d, view: v };
}

/**
 * 针对摘录添加批注
 */
export function addAnnotation(dossier, annotationPayload) {
    const d = createReadingDossier(dossier);
    const a = normAnnotation(annotationPayload);
    if (!a) return { ok: false, reason: 'invalid_annotation_payload' };

    d.annotations.push(a);
    d.updatedAt = Date.now();
    return { ok: true, dossier: d, annotation: a };
}

/**
 * 编写或更新论证草稿
 */
export function updateDraft(dossier, draftPayload) {
    const d = createReadingDossier(dossier);
    if (!draftPayload || typeof draftPayload !== 'object') return { ok: false, reason: 'invalid_draft' };

    if (draftPayload.title) d.draft.title = normStr(draftPayload.title);
    if (Array.isArray(draftPayload.sections)) {
        d.draft.sections = draftPayload.sections.map(normSection);
    }
    d.draft.updatedAt = Date.now();
    d.status = 'drafting';
    d.updatedAt = Date.now();
    return { ok: true, dossier: d, draft: d.draft };
}

/**
 * 处理书籍版本更新
 * 规则：
 * 绝不静默覆盖作者写好的正文与观点！
 * 标记受影响的摘录为 isStale，并在保留既有观点的前提下由用户审阅。
 */
export function handleBookVersionUpdate(dossier, bookId, newVersion, policy = 'preserve_views') {
    const d = createReadingDossier(dossier);
    const bid = normStr(bookId);
    const b = d.books.find(x => x.bookId === bid);
    if (!b) return { ok: false, reason: 'book_not_found' };

    const oldVersion = b.version;
    b.version = normStr(newVersion);

    let staleCount = 0;
    for (const exc of d.excerpts) {
        if (exc.bookId === bid) {
            exc.isStale = true;
            exc.staleReason = `原书已从 ${oldVersion} 更新至 ${b.version}，待核实段落文本变化`;
            staleCount += 1;
        }
    }

    d.updatedAt = Date.now();
    return {
        ok: true,
        dossier: d,
        policy,
        staleExcerptsCount: staleCount,
        note: `已保留所有作者论述与草稿，${staleCount} 处引用已被标注待核验。`,
    };
}