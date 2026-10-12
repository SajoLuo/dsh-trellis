export const hasWorkingDirectory = (() => {
  try { import.meta.resolve("@deepseek-ai/dsh-working-directory"); return true; }
  catch (error) { if (error.code === "ERR_MODULE_NOT_FOUND") return false; throw error; }
})();

/** Mount the real alpha directory/projection/filesystem composition when available. */
export async function mountWorkingDirectory(ctx) {
  if (!hasWorkingDirectory) return;
  const { default: LocalFileSystem } = await import("@deepseek-ai/dsh-fs-local");
  const { default: WorkingDirectory } = await import("@deepseek-ai/dsh-working-directory");
  await ctx.plugin(LocalFileSystem).await();
  await ctx.plugin(WorkingDirectory).await();
}
