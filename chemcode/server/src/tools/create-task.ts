// ====== create_task Tool ======
// Allows the LLM to create a named task for tracking progress.
// Replaces the hardcoded auto-task creation on every message.

import { toolRegistry } from './registry.js';
import { store } from '../store.js';

toolRegistry.register(
  {
    name: 'create_task',
    title: 'Create Task',
    description:
      'Create a new task to track progress on a complex or long-running job. ' +
      'Use this when starting a significant piece of work (e.g. running a simulation, ' +
      'analyzing a trajectory, building a model). ' +
      'Do NOT create a task for simple questions or quick one-line answers.',
    parameters: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'Short descriptive name for the task (e.g. "DPD AB 共聚物相分离模拟").',
        },
        description: {
          type: 'string',
          description: 'Detailed description of what this task will accomplish.',
        },
      },
      required: ['name'],
    },
    dangerous: false,
  },
  async (params, ctx) => {
    const taskName = String(params.name || 'Untitled task');
    const taskDesc = String(params.description || taskName);

    const data = store.data(ctx.userId);
    const taskId = `T-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 4)}`;

    const newTask = {
      id: taskId,
      name: taskName,
      calcType: 'machine_learning' as const,
      status: 'running' as const,
      description: taskDesc,
      progress: 0,
      createdAt: new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }),
      parameters: ctx.workdir ? { workspace: ctx.workdir } : undefined,
      jobs: [{ name: 'Agent 执行中', status: 'running' as const, detail: `工作目录: ${ctx.workdir || '默认'}` }],
      outputFiles: [] as string[],
    };

    data.tasks.unshift(newTask);
    store.commit(ctx.userId);

    return {
      content: `✅ 任务已创建: ${taskName} (ID: ${taskId})`,
      success: true,
      details: { taskId, taskName },
    };
  },
);

// ====== update_task Tool ======
// Allows the LLM to update a task's status or progress.

toolRegistry.register(
  {
    name: 'update_task',
    title: 'Update Task',
    description:
      'Update the status or progress of an existing task. ' +
      'Use this to mark a task as completed, failed, or update its progress percentage.',
    parameters: {
      type: 'object',
      properties: {
        taskId: {
          type: 'string',
          description: 'The task ID returned by create_task (e.g. "T-xxx").',
        },
        status: {
          type: 'string',
          description: 'New status: "running", "completed", or "error".',
        },
        progress: {
          type: 'number',
          description: 'Progress percentage 0-100.',
        },
        detail: {
          type: 'string',
          description: 'Short status detail (e.g. "已完成 5 个工具调用").',
        },
      },
      required: ['taskId'],
    },
    dangerous: false,
  },
  async (params, ctx) => {
    const taskId = String(params.taskId);
    const data = store.data(ctx.userId);
    const task = data.tasks.find((t) => t.id === taskId);

    if (!task) {
      return { content: `Error: 任务 ${taskId} 不存在`, success: false };
    }

    if (params.status) task.status = params.status as any;
    if (params.progress !== undefined) task.progress = Number(params.progress);
    if (params.detail && task.jobs && task.jobs[0]) {
      task.jobs[0].detail = String(params.detail);
      task.jobs[0].status = params.status === 'completed' ? 'completed' : params.status === 'error' ? 'error' : 'running';
    }
    if (params.status === 'completed') {
      task.completedAt = new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
      task.progress = 100;
    }

    store.commit(ctx.userId);
    return {
      content: `✅ 任务 ${task.name} 已更新: ${params.status || ''} ${params.progress !== undefined ? `${params.progress}%` : ''}`,
      success: true,
    };
  },
);
