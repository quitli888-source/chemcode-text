# ChemAgent v2 知识库后端架构 - 代码审查报告

项目根目录: M:\agents-for madao\v2\chemcode-text\chemcode-text\chemcode

---

## 文件 1: server/src/knowledge-store.ts

绝对路径: M:\agents-for madao\v2\chemcode-text\chemcode-text\chemcode\server\src\knowledge-store.ts

### [严重] 路径遍历漏洞 (第 48-50 行)
fileFor(userId) 直接将 userId 拼入文件路径 path.join(knowledgeDir(), userId + ".jsonl")。
若 userId 含 "../"（例如 "../../etc/passwd"），可读写任意 JSONL 文件。
userId 虽来自 JWT sub，但一旦签名密钥泄露或登录逻辑未严格校验，即可被利用。

建议修复: 对 userId 做白名单清理:
  if (!/^[a-zA-Z0-9_-]+$/.test(userId)) throw new Error("invalid userId");
或用 crypto.createHash("sha256").update(userId).digest("hex") 作为文件名。

### [严重] 缓存与磁盘状态不一致 (第 105-120 行)
appendRecord 在 fs.appendFileSync 失败时只打印 warn，但第 114-119 行仍然更新内存缓存。
导致内存有该记录但磁盘没有。后续 updateRecord/deleteRecord 调用 rewriteFile 会把"幽灵记录"写入磁盘，形成恶性循环。

建议修复: appendFileSync 失败时应 throw，且不更新缓存。

### [严重] updateRecord/deleteRecord 在 rewriteFile 失败后内存已被污染 (第 123-140, 282-293 行)
updateRecord 先执行 records[idx] = { ...records[idx], ...patch }（直接修改缓存数组引用），再调用 rewriteFile。
若 rewriteFile 的 writeFileSync/renameSync 抛错，catch 只 warn，但内存已被修改。
重启后从磁盘加载会回滚，但运行期间内存与磁盘不一致。deleteRecord 同理（records.splice 已执行）。

建议修复: 先深拷贝 records 再修改，rewriteFile 成功后才更新缓存:
  const newRecords = records.slice();
  newRecords[idx] = { ...newRecords[idx], ...patch, updatedAt: new Date().toISOString() };
  rewriteFile(userId, newRecords); // 失败则 throw
  cache.set(userId, newRecords);   // 成功后才更新

### [严重] rewriteFile 的 .tmp 文件未清理 (第 285-292 行)
若 writeFileSync 成功但 renameSync 失败，.tmp 文件残留。
多次失败后磁盘会堆积大量 .tmp 文件。

建议修复: 在 catch 块中尝试 fs.unlinkSync(tmp)，并用 finally 保证清理。

### [严重] 缓存 eviction 后永久丢失头部记录 (第 81-90 行)
当 records 超过 MAX_CACHE_ENTRIES 时 splice(0, evicted) 删除最旧记录，然后 cache.set。
但磁盘文件仍包含这些记录。后续所有 getRecords 都命中缓存（返回截断后数组），
searchRecords/retrieveRelevant 也基于截断后数据搜索，导致旧记录永远搜不到，直到进程重启。

建议修复: 不在内存中 evict，或改为 LRU 淘汰策略；更稳妥是改为流式读取+分页。

### [中等] getRecords 分页与 eviction 冲突 (第 60-91 行)
缓存被 eviction 后，offset 是相对于截断后数组的。
调用者传 offset=100 时，实际跳过的是截断后数组第 100 条，而非原始数据第 100 条，
导致分页错位、数据重复或遗漏。

### [中等] countRecords 与 getRecords 返回数量不一致 (第 94-102 行)
有缓存时返回 cached.length（已被 eviction 裁剪），无缓存时遍历磁盘返回真实行数。
同一用户在不同时刻调用可能返回不同 total，前端分页会错乱。

建议修复: 缓存中应单独保存 diskCount，eviction 时不更新它。

### [中等] searchRecords 性能问题 (第 144-203 行)
每次搜索都遍历所有记录并对每个记录做多次 toLowerCase() + includes，
对大知识库（数千条）每次调用都重复计算。
retrieveRelevant 在每条用户消息时调用（WS 路径），会造成可感知延迟。

建议修复: 构建倒排索引，或在缓存加载时预计算小写化的 title/content/tags 字段。

### [中等] 并发写入竞态 (rewriteFile 第 282-293 行)
rewriteFile 是非原子操作（先写 tmp 再 rename），若进程在 writeFileSync 后、renameSync 前崩溃，
磁盘上会残留 .tmp 文件且原文件未被更新，下次启动数据是旧版本。

建议修复: 启动时扫描清理 .tmp.* 残留文件；或使用 fs.renameSync 前先 fs.fsync。

### [轻微] searchRecords 中 options.importance! 非空断言多余 (第 161 行)
if (options?.importance !== undefined) 已保证非 undefined，但用 ! 断言掩盖了类型意图。
建议在 if 块内用局部变量保存值。

### [轻微] createRecord 未校验 content 长度 (第 248-279 行)
调用者可能传入超长 content（如 50MB 文本），直接 JSON.stringify 写入磁盘会导致单行 JSONL 极大，
影响后续 split("\n") 和 JSON.parse 性能。

建议修复: 在 createRecord 内做 content.slice(0, MAX_CONTENT_LEN) 常量化限制。

### [轻微] ensureKnowledgeDir 吞掉所有错误 (第 52-56 行)
mkdirSync 失败时 catch {} 完全忽略，可能是权限错误、磁盘满等严重问题，应至少记录。

---

## 文件 2: server/src/routes/knowledge.ts

绝对路径: M:\agents-for madao\v2\chemcode-text\chemcode-text\chemcode\server\src\routes\knowledge.ts

### [严重] learn-chat 中 sessionId 未校验导致崩溃 (第 250-265 行)
请求体只校验了 messages，未校验 sessionId。
第 265 行 sessionId.slice(-8) 与第 322 行 sessionId.slice(-8) 会因 sessionId 为 undefined 抛 "Cannot read properties of undefined"。
该错误虽被 ah 包装器捕获，但前端会收到 500 错误而非明确的 400。

建议修复:
  const { sessionId, messages } = req.body || {};
  if (!sessionId || typeof sessionId !== "string") {
    return sendErr(res, "BAD_REQUEST", "sessionId is required", 400);
  }

### [严重] POST / 的 body 校验不充分 (第 110-114 行)
  const { title, category, content, tags, parentPath, importance } = req.body || {};
  if (!title || !content) { ... }

问题:
- title/content 未校验类型，可能是对象、数组、数字等非字符串，直接传给 createRecord 后 JSON.stringify 可行但语义错误。
- tags 未校验是否为数组，若传 tags: "foo" 会导致 tags.join(" ") 在 searchRecords 中正常但存储类型错误。
- importance 用 Number(importance) 转换，Number("abc") = NaN，Number(null) = 0，会被静默接受。

建议修复:
  if (typeof title !== "string" || typeof content !== "string") {
    return sendErr(res, "BAD_REQUEST", "title and content must be strings", 400);
  }
  if (tags !== undefined && !Array.isArray(tags)) {
    return sendErr(res, "BAD_REQUEST", "tags must be an array", 400);
  }
  if (importance !== undefined && (isNaN(Number(importance)) || Number(importance) < 0 || Number(importance) > 2)) {
    return sendErr(res, "BAD_REQUEST", "importance must be 0, 1, or 2", 400);
  }

### [严重] learn-file 中未校验文件类型白名单 (第 378-405 行)
multer 配置 storage 和 limits.fileSize，但没有 fileFilter。
任何扩展名（包括 .exe、.bat、.sh）都会被接受并尝试 extractTextFromFile。
虽然 fallback 会检测 null 字节并拒绝，但 .exe 仍会被写入 uploads/knowledge/ 目录（尽管后续 unlink）。
更严重：multer 默认会写完整文件到磁盘，50MB 恶意文件会先占满磁盘。

建议修复: 添加 fileFilter:
  const ALLOWED_EXTS = new Set([".txt",".md",".html",".htm",".csv",".json",".xml",".yaml",".yml",".pdf",".docx",".doc",".pptx",".xlsx",".tex",".rtf",".log",".py",".js",".ts"]);
  const upload = multer({
    storage: knowledgeStorage,
    limits: { fileSize: 50 * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      if (ALLOWED_EXTS.has(ext)) cb(null, true);
      else cb(new Error("File type " + ext + " not allowed"));
    },
  });

### [严重] learn-file 中 file.originalname 直接用于 LLM prompt (第 428 行)
file.originalname 来自客户端，未转义。若含特殊字符或注入提示词（如 "; ignore previous instructions; "），
会被直接拼入 system prompt，构成 prompt injection。

建议修复: 对 file.originalname 做清洗，只保留 [a-zA-Z0-9._-]:
  const safeName = file.originalname.replace(/[^\w.\-]+/g, "_");
注意：multer storage 的 filename 已做此清洗，但 prompt 里用的是原始名。

### [严重] GET / 中 offset/limit 解析允许负数 (第 51-52 行)
  const offset = parseInt((req.query.offset as string) || "0", 10) || 0;
  const limit = parseInt((req.query.limit as string) || "0", 10) || 0;

offset=-5 会被解析为 -5，slice(-5, ...) 会从数组末尾取，行为非预期。
limit=-1 同理，slice(0, -1) 会丢掉最后一条。

建议修复:
  const offset = Math.max(0, parseInt((req.query.offset as string) || "0", 10) || 0);
  const limit = Math.max(0, parseInt((req.query.limit as string) || "0", 10) || 0);

### [严重] GET / 中双重 getRecords 调用导致缓存污染 (第 57-71 行)
  let records = getRecords(req.userId!, offset, limit);  // 第一次调用，返回分页后的数组
  if (parentPath || importance !== undefined) {
    const all = getRecords(req.userId!);  // 第二次调用，返回完整数组
    // ... filter ...
    records = limit > 0 ? filtered.slice(offset, offset + limit) : filtered;
  }

第一次调用返回的是 cached.slice(offset, offset+limit)，不会污染缓存（slice 返回新数组）。
但逻辑混乱：若 parentPath 有值，第一次 getRecords(offset, limit) 的返回值被完全丢弃，浪费了一次缓存查询。
更重要的是：countRecords(req.userId!) 和 getTreeStructure(req.userId!) 在第 75-76 行又各自查询，三次重复查询。

建议修复: 只调用一次 getRecords(req.userId!) 取全量，在内存中 filter + slice。

### [中等] resolveLLM 中 provider 可能为空字符串 (第 529 行)
  const extraBody = buildExtraBody(model.provider || "", false);
buildExtraBody 接收空字符串可能行为未定义。应校验 provider 非空。

### [中等] learn 路由的 rawContent.slice(0, 12000) 硬编码 (第 183, 302, 451 行)
12000 字符限制硬编码在三处，若需调整需改三处。应提取为常量:
  const MAX_LEARN_CONTENT = 12000;

### [中等] learn-chat 的 transcript 无长度限制 (第 257-259 行)
  const transcript = messages.map(...).join("\n\n");

若 messages 数组很大（如 1000 条），transcript 可能达到数 MB，
第 302 行 transcript.slice(0, 12000) 虽然截断，但 rawContent: transcript（第 327 行）会存储完整未截断的 transcript 到 JSONL，造成磁盘膨胀。

建议修复: rawContent: transcript.slice(0, 50000)。

### [中等] learn 路由的 JSON 解析失败分支 (第 198-215 行)
  try {
    const cleaned = llmOutput.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
    parsed = JSON.parse(cleaned);
  } catch {
    const record = createRecord(...);
    return sendOk(res, { record, learned: true, ... });
  }

catch 块中用 return sendOk 退出，逻辑正确。
但 parsed 变量在 try 块外被引用（第 217-227 行），TypeScript 编译器可能警告 parsed 在 catch 路径未赋值。
若未来有人删除 catch 中的 return，会导致 parsed 为 undefined 继续执行。建议改为 if/else 结构更清晰。

### [轻微] learn-file 的 importance 类型混乱 (第 386-387 行)
  const importanceRaw = req.body.importance as string | undefined;
  const importance = importanceRaw !== undefined ? Number(importanceRaw) : undefined;

multer 解析 multipart 时所有字段都是 string，所以这里 as string 合理。
但若 importance 传 "" 空字符串，Number("") = 0，会被当作 importance=0 接受。
应校验 !isNaN(importance)。

### [轻微] 整个路由使用 req.userId! 非空断言 (多处)
requireAuth 中间件保证 req.userId 已设置，但用 ! 断言掩盖了类型安全。
若未来移除 requireAuth 或改路由顺序，TS 不会报错。

建议修复: 定义类型收窄的中间件:
  function authedReq(req: Request): asserts req is Request & { userId: string } {
    if (!req.userId) throw new Error("unauthorized");
  }

---

## 文件 3: server/src/file-extractor.ts

绝对路径: M:\agents-for madao\v2\chemcode-text\chemcode-text\chemcode\server\src\file-extractor.ts

### [严重] HTML 解析顺序错误导致 .html/.htm/.xhtml 永远走错误分支 (第 22-43, 77-80 行)
textExts 集合中已包含 ".html"、".htm"、".xhtml"（第 28 行）。
因此所有 HTML 文件会在第一个 if (textExts.has(ext)) 命中，直接返回 cleanText(content)，
即未清理 HTML 标签的原始内容（含 <script>、<style> 等）。
后面第 77-80 行的 cleanHtml 处理分支永远不会执行，是死代码。

建议修复: 将 ".html"、".htm"、".xhtml" 从 textExts 中移除，让它们走第 77-80 行的 cleanHtml 分支。

### [严重] .rtf 同样被 textExts 提前拦截 (第 30, 71-74 行)
".rtf" 也在 textExts 中（第 30 行），导致第 71-74 行的 cleanRtf 分支永远不会执行。
.rtf 文件会以原始 RTF 控制码形式返回（含 \rtf1、\ansi 等），对 LLM 学习毫无价值。

建议修复: 将 ".rtf" 从 textExts 中移除。

### [严重] PPTX/XLSX 用 binary 字符串匹配 XML，编码错误 (第 196-233 行)
  const buffer = fs.readFileSync(filePath);
  const text = buffer.toString("binary");

"binary" 别名是 "latin1"，每个字节映射为一个字符。
然后用正则 /<a:t[^>]*>([^<]*)<\/a:t>/g 匹配。
问题: PPTX/XLSX 内部 XML 是 UTF-8 编码，非 ASCII 字符（如中文）会被错误解码为 latin1，
再 match 出来的字符串再传入 decodeXmlEntities，结果中文字符全部乱码。

建议修复: 用正确的 ZIP 解压库（如 adm-zip 或 yauzl）解压后，对每个 XML 文件用 utf-8 解码:
  import AdmZip from "adm-zip";
  const zip = new AdmZip(filePath);
  const entries = zip.getEntries();
  const texts = entries
    .filter(e => e.entryName.startsWith("ppt/slides/slide") && e.entryName.endsWith(".xml"))
    .map(e => e.getData().toString("utf-8"));
  const allXml = texts.join("\n");
  const matches = allXml.match(/<a:t[^>]*>([^<]*)<\/a:t>/g) || [];

### [严重] extractLegacyDoc 对非 ASCII（中文等）全部丢失 (第 169-193 行)
循环只保留 0x20-0x7e 范围的可打印 ASCII。
中文 .doc 文档中的所有中文内容会被当作"非可打印"过滤掉，只保留零星英文。
这对中文用户完全不可用。

建议修复: 使用 antiword 或 catdoc 命令行工具，或要求用户先转换为 .docx。
至少在文档中明确说明 .doc 仅支持英文。

### [中等] cleanHtml 的正则无法处理嵌套 <script> (第 107-129 行)
  .replace(/<script[\s\S]*?<\/script>/gi, "")

若 HTML 中有 <script>var s = "</script>";</script>，正则会在第一个 </script> 处停止，
导致后面的 ";</script> 残留。虽然这是边缘情况，但可能被恶意构造用于 prompt injection。

建议修复: 使用专门的 HTML 解析库（如 cheerio）做标签剥离，而非正则。

### [中等] fallback 分支读取整个文件到内存 (第 82-93 行)
  const content = fs.readFileSync(filePath, "utf-8");

若上传的是 50MB 二进制文件（未被 fileFilter 拦截），会一次性读入内存。
多个并发请求可能导致 OOM。

建议修复: 在读取前先检查文件大小，超过阈值（如 10MB）则拒绝。

### [中等] extractPdf 中 pdfParse 类型用 any (第 147-148 行)
  const pdfParseModule = await import("pdf-parse");
  const pdfParse = (pdfParseModule as any).default || pdfParseModule;

用 any 绕过类型检查，若 pdf-parse 的 API 变化不会有编译期警告。

建议修复: 安装 @types/pdf-parse 或自定义类型声明。

### [中等] 所有异步函数实际是同步 fs 操作 (第 145-233 行)
extractPdf 和 extractDocx 是 async，但内部用 fs.readFileSync 同步读取。
extractTextFromFile 虽声明为 async，但大部分分支（textExts、rtf、html、pptx、xlsx、legacy doc）都是同步。
这会阻塞 Node 事件循环，影响并发。

建议修复: 改用 fs.promises.readFile，或明确文档说明这是 CPU 密集型操作。

### [轻微] decodeXmlEntities 中 String.fromCharCode 不支持代理对 (第 236-245 行)
  .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))

对于码点 > 0xFFFF 的字符（如 emoji），String.fromCharCode 会返回错误的代理对。
应用 String.fromCodePoint:
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))

### [轻微] textExts 集合每次调用都重新创建 (第 22-38 行)
extractTextFromFile 每次调用都 new Set([...])，浪费 GC。
建议提到模块顶层 const TEXT_EXTS = new Set([...])。

### [轻微] extractLegacyDoc 的 currentWord 阈值硬编码 (第 181 行)
if (currentWord.length > 3) 只保留长度 > 3 的词，会丢失短词（如 "H2O"）。
建议改为 >= 2 或可配置。
