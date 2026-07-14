// ====== database_search Tool ======
// 让 agent 在对话中主动检索论文数据库，获取相关段落作为上下文。
// 支持语义检索（SiliconFlow embedding）和关键词检索（自动降级）。

import { toolRegistry } from './registry.js';
import { search, getCollectionStatus } from '../db/qdrant.js';

toolRegistry.register(
  {
    name: 'database_search',
    title: '论文数据库检索',
    description: '在化学论文向量数据库中检索与问题相关的论文片段。返回最相关的论文段落，包含标题、年份、DOI、章节和正文内容。可用于查找文献依据、获取技术细节、验证化学概念等。',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: '检索问题或关键词，支持中英文。例如："DNA过度拉伸的机制"、"polymer self-assembly"、"聚合物分子量分布的逆向设计"',
        },
        top_k: {
          type: 'number',
          description: '返回结果数量，默认 5，最大 20。',
        },
      },
      required: ['query'],
    },
  },
  async (params) => {
    const query = String(params.query || '').trim();
    if (!query) {
      return { content: '请提供检索关键词。', success: false };
    }

    const topK = Math.min(Math.max(Number(params.top_k) || 5, 1), 20);

    try {
      const result = await search(query, topK);

      if (result.results.length === 0) {
        return {
          content: `未找到与"${query}"相关的论文片段。请尝试其他关键词。`,
          success: true,
          details: { query, results_count: 0, search_type: result.search_type },
        };
      }

      // 格式化为 LLM 可读的上下文
      const formatted = result.results.map((r, idx) => {
        const p = r.payload;
        const score = r.score != null ? `${(r.score * 100).toFixed(1)}%` : 'N/A';
        return [
          `[${idx + 1}] 相似度: ${score}`,
          `标题: ${p.display_title || 'N/A'}`,
          `年份: ${p.year || 'N/A'}`,
          `DOI: ${p.doi || 'N/A'}`,
          `章节: ${p.section || 'N/A'}`,
          `Chunk: #${p.chunk_index}`,
          `源文件: ${p.source_path || 'N/A'}`,
          `内容:\n${p.chunk_text}`,
          '---',
        ].join('\n');
      }).join('\n');

      const summary = [
        `检索"${query}"完成，方式: ${result.search_type}，返回 ${result.results.length} 条结果。`,
        result.translated_keywords?.length ? `翻译关键词: ${result.translated_keywords.join(', ')}` : '',
        '',
        formatted,
      ].filter(Boolean).join('\n');

      return {
        content: summary,
        success: true,
        details: {
          query,
          search_type: result.search_type,
          results_count: result.results.length,
          translated_keywords: result.translated_keywords,
        },
      };
    } catch (e: any) {
      return {
        content: `数据库检索失败: ${e.message}`,
        success: false,
      };
    }
  },
);

// 同时注册一个查看数据库状态的 tool
toolRegistry.register(
  {
    name: 'database_status',
    title: '数据库状态',
    description: '查看论文数据库的连接状态、记录数量和配置信息。',
    parameters: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
  async () => {
    try {
      const status = await getCollectionStatus();
      return {
        content: [
          `数据库状态: ${status.connected ? '已连接' : '未连接'}`,
          `Collection: ${status.collection_name}`,
          `论文数量: ${status.points_count}`,
          `向量维度: ${status.vector_size}`,
          `距离算法: ${status.distance}`,
          `Embedding: ${status.embedding_provider} (${status.embedding_available ? '可用' : '不可用'})`,
        ].join('\n'),
        success: true,
        details: status as unknown as Record<string, unknown>,
      };
    } catch (e: any) {
      return { content: `状态查询失败: ${e.message}`, success: false };
    }
  },
);
