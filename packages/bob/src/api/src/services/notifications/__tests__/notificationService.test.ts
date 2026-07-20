import { beforeEach, describe, expect, it, vi } from "vitest";

const sendPushNotification = vi.fn();

vi.mock("../../push/pushService.js", () => ({
  sendPushNotification: (...args: unknown[]) => sendPushNotification(...args),
}));

import {
  createInAppNotification,
  markAllNotificationsAsRead,
} from "../notificationService.js";

describe("notificationService", () => {
  const returning = vi.fn();
  const values = vi.fn(() => ({ returning }));
  const insert = vi.fn(() => ({ values }));
  const updateReturning = vi.fn();
  const updateWhere = vi.fn(() => ({ returning: updateReturning }));
  const updateSet = vi.fn(() => ({ where: updateWhere }));
  const update = vi.fn(() => ({ set: updateSet }));
  const prefFindFirst = vi.fn();

  const db = {
    insert,
    update,
    query: {
      userPreferences: {
        findFirst: prefFindFirst,
      },
    },
  } as never;

  beforeEach(() => {
    vi.clearAllMocks();
    prefFindFirst.mockResolvedValue({ pushNotifications: true });
    returning.mockResolvedValue([
      {
        id: "notif-1",
        userId: "user-2",
        workItemId: "wi-1",
        actorId: "user-1",
        type: "work_item_commented",
        title: "New comment",
        body: "hello",
        url: "/work-items/wi-1",
        read: false,
        readAt: null,
        archivedAt: null,
        createdAt: "2026-07-20T00:00:00.000Z",
      },
    ]);
    updateReturning.mockResolvedValue([{ id: "a" }, { id: "b" }]);
  });

  it("inserts an inbox row and sends push by default", async () => {
    sendPushNotification.mockResolvedValueOnce({
      success: true,
      sent: 1,
      failed: 0,
      errors: [],
    });

    const result = await createInAppNotification(db, {
      userId: "user-2",
      workItemId: "wi-1",
      actorId: "user-1",
      type: "work_item_commented",
      title: "New comment",
      body: "hello",
      url: "/work-items/wi-1",
    });

    expect(insert).toHaveBeenCalled();
    expect(values).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user-2",
        type: "work_item_commented",
        title: "New comment",
      }),
    );
    expect(sendPushNotification).toHaveBeenCalledWith(
      "user-2",
      expect.objectContaining({
        title: "New comment",
        body: "hello",
        data: expect.objectContaining({
          type: "work_item_commented",
          notificationId: "notif-1",
        }),
      }),
    );
    expect(result.id).toBe("notif-1");
  });

  it("skips push when push:false", async () => {
    await createInAppNotification(db, {
      userId: "user-2",
      type: "task_completed",
      title: "Done",
      push: false,
    });

    expect(sendPushNotification).not.toHaveBeenCalled();
  });

  it("skips push when user disabled pushNotifications", async () => {
    prefFindFirst.mockResolvedValueOnce({ pushNotifications: false });

    await createInAppNotification(db, {
      userId: "user-2",
      type: "task_completed",
      title: "Done",
    });

    expect(sendPushNotification).not.toHaveBeenCalled();
  });

  it("does not fail the inbox write when push throws", async () => {
    sendPushNotification.mockRejectedValueOnce(new Error("expo down"));

    const result = await createInAppNotification(db, {
      userId: "user-2",
      type: "batch_completed",
      title: "Batch done",
    });

    expect(result.id).toBe("notif-1");
  });

  it("marks all unread notifications as read for the user", async () => {
    const result = await markAllNotificationsAsRead(db, "user-1");
    expect(update).toHaveBeenCalled();
    expect(updateSet).toHaveBeenCalledWith(
      expect.objectContaining({
        read: true,
      }),
    );
    expect(result).toEqual({ count: 2 });
  });
});
