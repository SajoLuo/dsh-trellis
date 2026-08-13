/**
 * Node filesystem shim implementing the narrow surface workflow.js needs.
 *
 * @module dsh-trellis/node-fs
 */
import { stat as nodeStat, readFile as nodeReadFile, readdir as nodeReaddir } from "node:fs/promises";

/** @type {import("./workflow.js").FsShim} */
export const nodeFs = {
  async exists(path) {
    try {
      await nodeStat(path);
      return true;
    } catch {
      return false;
    }
  },
  async stat(path) {
    try {
      const info = await nodeStat(path);
      return { mtimeMs: info.mtimeMs };
    } catch {
      return null;
    }
  },
  async readFile(path) {
    try {
      return await nodeReadFile(path, "utf8");
    } catch {
      return null;
    }
  },
  async listDir(path) {
    try {
      return await nodeReaddir(path);
    } catch {
      return [];
    }
  },
};
