export type RenderRequest = () => void;

export function createRenderScheduler(render: () => void): RenderRequest {
  let queued = false;

  return () => {
    if (queued) return;
    queued = true;
    queueMicrotask(() => {
      queued = false;
      render();
    });
  };
}
