import type { Tool } from "../types";
import { getCurrentTimeTool } from "./get-current-time";
import { calculateTool } from "./calculate";
import { readTool } from "./read";
import { writeTool } from "./write";
import { editTool } from "./edit";
import { bashTool } from "./bash";
import { loadSkillTool } from "./load-skill";
import { listDirectoryTool } from "./list-directory";

export const tools: Tool[] = [
  getCurrentTimeTool,
  calculateTool,
  listDirectoryTool,
  readTool,
  writeTool,
  editTool,
  bashTool,
  loadSkillTool,
];
