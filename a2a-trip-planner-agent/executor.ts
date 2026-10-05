import { TaskState } from '@a2a-js/sdk';
import {
  AgentEvent,
  type AgentExecutor,
  type ExecutionEventBus,
  type RequestContext,
} from '@a2a-js/sdk/server';
import { runSkill } from './skills.ts';

/** Delay between streamed chunks, long enough that a cancel can land between them. */
const STREAM_INTERVAL_MS = 1000;

/** Joins the text parts of the incoming message; non-text parts are ignored. */
function messageText(context: RequestContext): string {
  const parts = context.request.message?.parts ?? [];
  return parts
    .map((part) => (part.content?.$case === 'text' ? part.content.value : ''))
    .filter(Boolean)
    .join(' ');
}

/**
 * Runs the skill named by the message text and reports it as a task.
 * skills.ts holds the behaviour; this file maps it onto A2A events.
 */
export class TripPlannerExecutor implements AgentExecutor {
  private readonly cancelled = new Set<string>();

  cancelTask = async (taskId: string, _eventBus: ExecutionEventBus): Promise<void> => {
    this.cancelled.add(taskId);
  };

  execute = async (
    requestContext: RequestContext,
    eventBus: ExecutionEventBus
  ): Promise<void> => {
    try {
      await this.run(requestContext, eventBus);
    } finally {
      // The flag belongs to this run, so it is dropped here whatever the run
      // did: completed, streamed to the end, cancelled, or threw.
      this.cancelled.delete(requestContext.taskId);
    }
  };

  private run = async (
    requestContext: RequestContext,
    eventBus: ExecutionEventBus
  ): Promise<void> => {
    const { taskId, contextId } = requestContext;

    // The server rejects a stream that does not open with a task or message.
    eventBus.publish(
      AgentEvent.task({
        id: taskId,
        contextId,
        status: { state: TaskState.TASK_STATE_SUBMITTED, message: undefined, timestamp: undefined },
        artifacts: [],
        history: [],
        metadata: {},
      })
    );
    eventBus.publish(
      AgentEvent.statusUpdate({
        taskId,
        contextId,
        status: { state: TaskState.TASK_STATE_WORKING, message: undefined, timestamp: undefined },
        metadata: {},
      })
    );

    const result = runSkill(messageText(requestContext));
    const chunks = result.kind === 'stream' ? result.chunks : [result.text];

    for (const [index, chunk] of chunks.entries()) {
      if (this.cancelled.has(taskId)) {
        this.cancelled.delete(taskId);
        eventBus.publish(
          AgentEvent.statusUpdate({
            taskId,
            contextId,
            status: {
              state: TaskState.TASK_STATE_CANCELED,
              message: undefined,
              timestamp: undefined,
            },
            metadata: {},
          })
        );
        eventBus.finished();
        return;
      }

      eventBus.publish(
        AgentEvent.artifactUpdate({
          taskId,
          contextId,
          artifact: {
            artifactId: `${taskId}-result`,
            name: 'result',
            description: '',
            parts: [
              {
                content: { $case: 'text', value: chunk },
                metadata: {},
                filename: '',
                mediaType: 'text/plain',
              },
            ],
            metadata: {},
            extensions: [],
          },
          append: index > 0,
          lastChunk: index === chunks.length - 1,
          metadata: {},
        })
      );

      if (result.kind === 'stream' && index < chunks.length - 1) {
        await new Promise((resolve) => setTimeout(resolve, STREAM_INTERVAL_MS));
      }
    }

    eventBus.publish(
      AgentEvent.statusUpdate({
        taskId,
        contextId,
        status: { state: TaskState.TASK_STATE_COMPLETED, message: undefined, timestamp: undefined },
        metadata: {},
      })
    );
    eventBus.finished();
  };
}
