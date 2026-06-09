// ====== Qdrant 向量数据库连接 ======
// 通过 SSH 直连阿里云服务器 (1.95.65.154:22)，在服务器上查询 Qdrant REST API。
// 启动时一次性加载全部 points 到内存，后续检索在本地完成（毫秒级）。

import { Client } from 'ssh2';

// ============ 硬编码的服务器连接 ============
const SSH_CONFIG = {
  host: '1.95.65.154',
  port: 22,
  username: 'root',
  password: process.env.QDRANT_SSH_PASSWORD || '',
  readyTimeout: 10000,
};

const QDRANT_URL = 'http://127.0.0.1:6333';
const QDRANT_API_KEY = process.env.QDRANT_API_KEY || '';
const COLLECTION = 'chemchat_papers';

// ============ Embedding 配置 ============
// 默认使用 SiliconFlow（BAAI/bge-m3）
let _embeddingProvider: string = process.env.EMBEDDING_PROVIDER || 'siliconflow';
let _embeddingApiKey: string = process.env.EMBEDDING_API_KEY || 'sk-trlxmuodupqmahaknhjokaxaqxxopdbpqtjitbzaollmikll';
let _embeddingModel: string = process.env.EMBEDDING_MODEL || 'BAAI/bge-m3';

// ============ 本地缓存 ============
let _cachedPoints: QdrantPoint[] = [];
let _cacheLoaded = false;
let _cacheLoading = false;

// ============ 类型 ============

export interface QdrantPoint {
  id: string;
  score?: number;
  payload: {
    paper_id: string;
    display_title: string;
    doi: string | null;
    year: string | null;
    source_path: string;
    section: string;
    chunk_index: number;
    chunk_text: string;
  };
}

export interface CollectionStatus {
  collection_name: string;
  status: string;
  points_count: number;
  vector_size: number;
  distance: string;
  connected: boolean;
  embedding_provider: string;
  embedding_available: boolean;
}

// ============ 中英文关键词映射 ============
const CN_EN_MAP: Record<string, string> = {
  '聚合物': 'polymer', '分子量': 'molecular weight', '分布': 'distribution',
  '逆向设计': 'inverse design', '共价': 'covalent', '框架': 'framework',
  '电池': 'battery', '催化': 'catal', '纳米': 'nano', '晶体': 'crystal',
  '蛋白质': 'protein', 'dna': 'dna', 'rna': 'rna', '脂质': 'lipid',
  '表面': 'surface', '界面': 'interface', '溶液': 'solution',
  '动力学': 'dynamics', '热力学': 'thermodynamic', '光谱': 'spectroscop',
  '合成': 'synthes', '反应': 'reaction', '氧化': 'oxid',
  '还原': 'reduct', '酸': 'acid', '碱': 'base', '盐': 'salt',
  '有机': 'organic', '无机': 'inorganic', '金属': 'metal',
  '碳': 'carbon', '氢': 'hydrogen', '氧': 'oxygen', '氮': 'nitrogen',
  '拉伸': 'stretch', '过度': 'over', '机制': 'mechanism',
  '自组装': 'self-assembly', '胶束': 'micell', '囊泡': 'vesicl',
  '凝胶': 'gel', '膜': 'membrane', '吸附': 'adsorb',
  '电化学': 'electrochem', '光电': 'photovoltaic', '发光': 'luminescen',
  '半导体': 'semiconductor', '超导': 'superconduct',
  '分子动力学': 'molecular dynamics', '模拟': 'simulation',
  '高分子': 'polymer', '嵌段共聚物': 'block copolymer',
  '交联': 'crosslink', '降解': 'degrad', '相变': 'phase transition',
  '玻璃化转变': 'glass transition', '结晶': 'crystalliz',
  '熔融': 'melt', '粘度': 'viscosity', '弹性': 'elastic',
  '过度拉伸': 'overstretch', '力学': 'mechanical',
};

// ============ SSH 执行 ============

function sshExec(cmd: string, timeoutMs: number = 15000): Promise<string> {
  return new Promise((resolve, reject) => {
    const conn = new Client();
    let stdout = '';
    let stderr = '';
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      conn.end();
      reject(new Error('SSH command timed out'));
    }, timeoutMs);

    conn.on('ready', () => {
      conn.exec(cmd, (err: Error | undefined, stream: any) => {
        if (err) {
          clearTimeout(timer);
          conn.end();
          return reject(new Error(`SSH exec error: ${err.message}`));
        }
        stream.on('close', (code: number) => {
          clearTimeout(timer);
          conn.end();
          if (timedOut) return;
          if (code !== 0 && !stdout) {
            reject(new Error(`SSH exited ${code}: ${stderr.slice(0, 200)}`));
          } else {
            resolve(stdout.trim());
          }
        });
        stream.on('data', (data: Buffer) => { stdout += data.toString(); });
        stream.stderr.on('data', (data: Buffer) => { stderr += data.toString(); });
      });
    });

    conn.on('error', (err: Error) => {
      clearTimeout(timer);
      if (!timedOut) reject(new Error(`SSH error: ${err.message}`));
    });

    conn.connect(SSH_CONFIG);
  });
}

async function qdrantApi(apiPath: string, method: string = 'GET', body?: string): Promise<any> {
  const headers = `-H "Content-Type: application/json" -H "api-key: ${QDRANT_API_KEY}"`;
  let curlCmd: string;
  if (method === 'POST' && body) {
    const escaped = body.replace(/'/g, "'\\''");
    curlCmd = `curl -s ${headers} -X POST -d '${escaped}' ${QDRANT_URL}${apiPath}`;
  } else {
    curlCmd = `curl -s ${headers} ${QDRANT_URL}${apiPath}`;
  }
  const raw = await sshExec(curlCmd);
  try { return JSON.parse(raw); } catch { throw new Error(`Qdrant parse failed: ${raw.slice(0, 300)}`); }
}

// ============ 缓存加载 ============

/**
 * 启动时调用：一条 SSH 命令从 Qdrant 加载全部 points 到内存。
 */
export async function preloadCache(): Promise<void> {
  if (_cacheLoading || _cacheLoaded) return;
  _cacheLoading = true;
  console.log('[qdrant] preloading all points via single SSH command...');

  try {
    // 用 cat + heredoc 写临时 Python 文件，再执行，避免引号转义地狱
    const pyScript = [
      'import json',
      'from qdrant_client import QdrantClient',
      `q = QdrantClient(url='${QDRANT_URL}', api_key='${QDRANT_API_KEY}')`,
      'all_p = []',
      'off = None',
      'while True:',
      `    pts, nxt = q.scroll(collection_name='${COLLECTION}', limit=500, offset=off, with_payload=True, with_vectors=False)`,
      '    if not pts: break',
      '    for p in pts:',
      '        all_p.append({"id":str(p.id),"payload":{"paper_id":p.payload.get("paper_id",""),"display_title":p.payload.get("display_title",""),"doi":p.payload.get("doi"),"year":p.payload.get("year"),"source_path":p.payload.get("source_path",""),"section":p.payload.get("section",""),"chunk_index":p.payload.get("chunk_index",0),"chunk_text":p.payload.get("chunk_text","")}})',
      '    if nxt is None: break',
      '    off = nxt',
      'print(json.dumps(all_p, ensure_ascii=False))',
    ].join('\n');

    // 写入临时文件再执行，彻底避免引号问题
    const cmd = `cat > /tmp/_preload.py << 'PYEOF'\n${pyScript}\nPYEOF\ncd /opt/chemchat && /opt/chemchat/venv/bin/python3 /tmp/_preload.py`;

    const raw = await sshExec(cmd, 60000);

    const arr = JSON.parse(raw) as QdrantPoint[];
    _cachedPoints = arr;
    _cacheLoaded = true;
    console.log(`[qdrant] cache loaded: ${arr.length} points`);
  } catch (e: any) {
    console.error(`[qdrant] cache preload failed: ${e.message}`);
  } finally {
    _cacheLoading = false;
  }
}

// ============ 公开接口 ============

export function updateEmbeddingConfig(opts: { provider?: string; apiKey?: string; model?: string }) {
  if (opts.provider) _embeddingProvider = opts.provider;
  if (opts.apiKey) _embeddingApiKey = opts.apiKey;
  if (opts.model) _embeddingModel = opts.model;
}

export function getConfig() {
  return {
    server: `${SSH_CONFIG.host}:${SSH_CONFIG.port}`,
    collection: COLLECTION,
    embedding_provider: _embeddingProvider,
    embedding_model: _embeddingModel,
    has_embedding_key: !!_embeddingApiKey,
    cached_points: _cachedPoints.length,
  };
}

export async function testConnection(): Promise<boolean> {
  try {
    const data = await qdrantApi(`/collections/${COLLECTION}`);
    return data?.result?.status === 'green' || data?.status === 'ok';
  } catch (e: any) {
    console.warn(`[qdrant] connection failed: ${e.message}`);
    return false;
  }
}

export async function getCollectionStatus(): Promise<CollectionStatus> {
  try {
    const data = await qdrantApi(`/collections/${COLLECTION}`);
    const result = data?.result || data;
    return {
      collection_name: COLLECTION,
      status: result?.status || 'unknown',
      points_count: result?.points_count || 0,
      vector_size: result?.config?.params?.vectors?.size || 0,
      distance: result?.config?.params?.vectors?.distance || 'unknown',
      connected: true,
      embedding_provider: _embeddingProvider,
      embedding_available: _embeddingProvider !== 'none' && !!_embeddingApiKey,
    };
  } catch {
    return {
      collection_name: COLLECTION, status: 'disconnected', points_count: 0,
      vector_size: 0, distance: 'unknown', connected: false,
      embedding_provider: _embeddingProvider, embedding_available: false,
    };
  }
}

/** 检索（本地缓存过滤，毫秒级） */
export async function search(query: string, topK: number = 10): Promise<{
  results: QdrantPoint[];
  search_type: string;
  translated_keywords?: string[];
  total_matching?: number;
}> {
  // 语义检索（需要 embedding API）
  if (_embeddingProvider !== 'none' && _embeddingApiKey) {
    try {
      const vector = await generateEmbedding(query);
      if (vector) {
        const results = await vectorSearch(vector, topK);
        return { results, search_type: 'semantic' };
      }
    } catch (e: any) {
      console.warn(`[qdrant] semantic failed, fallback: ${e.message}`);
    }
  }

  // 关键词检索（本地缓存，毫秒级）
  return keywordSearch(query, topK);
}

export async function scrollPoints(limit: number = 10): Promise<{ points: QdrantPoint[] }> {
  if (_cacheLoaded) {
    return { points: _cachedPoints.slice(0, limit) };
  }
  const body = JSON.stringify({ limit, with_payload: true, with_vector: false });
  const data = await qdrantApi(`/collections/${COLLECTION}/points/scroll`, 'POST', body);
  return { points: (data?.result?.points || []).map(normalizePoint) };
}

// ============ 语义检索（通过 SSH 调 Qdrant 向量搜索） ============

async function generateEmbedding(text: string): Promise<number[] | null> {
  if (_embeddingProvider === 'none' || !_embeddingApiKey) return null;
  const providers: Record<string, { url: string; model: string }> = {
    minimax: { url: 'https://api.minimaxi.com/v1/embeddings', model: 'embo-01' },
    siliconflow: { url: 'https://api.siliconflow.cn/v1/embeddings', model: 'BAAI/bge-m3' },
  };
  const p = providers[_embeddingProvider];
  if (!p) return null;
  const model = _embeddingModel || p.model;
  const res = await fetch(p.url, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${_embeddingApiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, input: text, encoding_format: 'float' }),
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) throw new Error(`Embedding ${res.status}`);
  const data = await res.json() as any;
  return data?.data?.[0]?.embedding || null;
}

async function vectorSearch(vector: number[], topK: number): Promise<QdrantPoint[]> {
  const body = JSON.stringify({ query: vector, limit: topK, with_payload: true });
  const data = await qdrantApi(`/collections/${COLLECTION}/points/query`, 'POST', body);
  return (data?.result?.points || []).map(normalizePoint);
}

// ============ 关键词检索（本地内存过滤） ============

function keywordSearch(query: string, topK: number): {
  results: QdrantPoint[];
  search_type: string;
  translated_keywords: string[];
  total_matching: number;
} {
  const queryLower = query.toLowerCase();
  const keywords = queryLower.split(/\s+/).filter(k => k.length >= 1);

  // 中文关键词翻译
  const translated: string[] = [];
  for (const [cn, en] of Object.entries(CN_EN_MAP)) {
    if (queryLower.includes(cn)) translated.push(en);
  }
  const allKeywords = [...keywords, ...translated].filter(k => k.length >= 2);

  if (allKeywords.length === 0) {
    // 没有有效关键词，返回空
    return { results: [], search_type: 'keyword', translated_keywords: [], total_matching: 0 };
  }

  // 在内存中过滤（O(n) 遍历，3518 条 < 1ms）
  const scored: Array<{ point: QdrantPoint; score: number }> = [];
  for (const p of _cachedPoints) {
    const text = [
      p.payload.display_title || '',
      p.payload.section || '',
      p.payload.chunk_text || '',
    ].join(' ').toLowerCase();

    let score = 0;
    for (const kw of allKeywords) {
      if (text.includes(kw)) score++;
    }
    if (score > 0) {
      scored.push({ point: p, score });
    }
  }

  // 按分数降序
  scored.sort((a, b) => b.score - a.score);

  const totalMatching = scored.length;

  // 截取 topK 条
  const results = scored.slice(0, topK).map((x) => ({
    ...x.point,
    score: Math.round((x.score / Math.max(allKeywords.length, 1)) * 10000) / 10000,
  }));

  return { results, search_type: 'keyword', translated_keywords: translated, total_matching: totalMatching };
}

// ============ 工具函数 ============

function normalizePoint(raw: any): QdrantPoint {
  return {
    id: String(raw.id),
    score: raw.score,
    payload: {
      paper_id: raw.payload?.paper_id || '',
      display_title: raw.payload?.display_title || '',
      doi: raw.payload?.doi || null,
      year: raw.payload?.year || null,
      source_path: raw.payload?.source_path || '',
      section: raw.payload?.section || '',
      chunk_index: raw.payload?.chunk_index ?? 0,
      chunk_text: raw.payload?.chunk_text || '',
    },
  };
}
