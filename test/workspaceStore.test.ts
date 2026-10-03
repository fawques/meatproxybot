import { describe, expect, it } from "vitest";
import { InMemoryWorkspaceStore } from "../src/workspaceStore.js";

describe("InMemoryWorkspaceStore", () => {
  it("stores and retrieves trigger emoji per workspace", () => {
    const store = new InMemoryWorkspaceStore();
    store.setTriggerEmoji("T123", "meat_proxy");
    expect(store.getTriggerEmoji("T123")).toBe("meat_proxy");
  });

  it("returns undefined for unconfigured workspaces", () => {
    const store = new InMemoryWorkspaceStore();
    expect(store.getTriggerEmoji("T999")).toBeUndefined();
  });

  it("allows different workspaces to have different emoji", () => {
    const store = new InMemoryWorkspaceStore();
    store.setTriggerEmoji("T123", "meat_proxy");
    store.setTriggerEmoji("T456", "robot_face");
    expect(store.getTriggerEmoji("T123")).toBe("meat_proxy");
    expect(store.getTriggerEmoji("T456")).toBe("robot_face");
  });

  it("clears workspace configuration", () => {
    const store = new InMemoryWorkspaceStore();
    store.setTriggerEmoji("T123", "meat_proxy");
    store.clearTriggerEmoji("T123");
    expect(store.getTriggerEmoji("T123")).toBeUndefined();
  });

  it("updates existing workspace configuration", () => {
    const store = new InMemoryWorkspaceStore();
    store.setTriggerEmoji("T123", "meat_proxy");
    store.setTriggerEmoji("T123", "robot_face");
    expect(store.getTriggerEmoji("T123")).toBe("robot_face");
  });
});
