import { Task } from "../models/mongo/Task";
import { logNotification } from "../services/notification.service";

function startOfDay(date = new Date()): Date {
  const start = new Date(date);
  start.setHours(0, 0, 0, 0);
  return start;
}

/** Tell each assignee about open tasks that are due today or overdue, once a day. */
export async function runTaskReminderJob(): Promise<{ reminded: number }> {
  const start = startOfDay();
  const tomorrow = new Date(start);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tasks = await Task.find({
    status: "open",
    dueAt: { $ne: null, $lt: tomorrow },
    assignedUserRef: { $ne: null },
    $or: [{ lastRemindedAt: null }, { lastRemindedAt: { $lt: start } }],
  }).limit(500);

  let reminded = 0;
  for (const task of tasks) {
    if (!task.assignedUserRef || !task.dueAt) continue;
    const overdue = new Date(task.dueAt).getTime() < start.getTime();
    await logNotification({
      entityType: "task",
      action: "assigned",
      actorType: "system",
      entityId: String(task._id),
      summary: overdue ? `Overdue: ${task.title}` : `Due today: ${task.title}`,
      customerRef: task.customerRef,
      recipientUserIds: [task.assignedUserRef],
      direct: true,
      metadata: {
        conversationId: task.inboxConversationRef ? String(task.inboxConversationRef) : "",
      },
    });
    task.lastRemindedAt = new Date();
    await task.save();
    reminded += 1;
  }
  return { reminded };
}
