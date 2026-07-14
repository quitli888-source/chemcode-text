// ====== Tools Index ======
// Import all tool implementations to trigger registration.
// The agent loop imports this file to ensure all tools are available.

export { toolRegistry } from './registry.js';
export type { ToolDefinition, ToolResult, ToolExecutionContext, ToolPermissionConfig } from './types.js';

// Import tool files to trigger side-effect registration.
import './file-read.js';
import './file-write.js';
import './bash-exec.js';
import './update-plan.js';
import './sessions-spawn.js';
import './database-search.js';
import './run-skill-script.js';
import './save-note.js';
import './create-task.js';
