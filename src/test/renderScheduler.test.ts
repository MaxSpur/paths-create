import { describe, expect, it, vi } from "vitest";

import { createRenderScheduler } from "../ui/renderScheduler";

describe("createRenderScheduler", () => {
  it("coalesces synchronous render requests into one microtask", async () => {
    const render = vi.fn();
    const requestRender = createRenderScheduler(render);

    requestRender();
    requestRender();
    requestRender();
    expect(render).not.toHaveBeenCalled();

    await Promise.resolve();
    expect(render).toHaveBeenCalledTimes(1);
  });
});
