import {
  parseLlmSlashCommandInvocation,
  type LlmSlashCommandInvocation,
} from "../../workflows/llmTools/toolRegistry";

export type SubmissionIntent =
  | {
      kind: "agent-ask";
      prompt: string;
    }
  | {
      kind: "agent-edit";
      prompt: string;
    }
  | {
      kind: "config";
    }
  | {
      allowedToolNames?: readonly string[];
      commandDirective?: string;
      kind: "llm-request";
      question: string;
    }
  | {
      kind: "say";
      text: string;
    }
  | {
      commandDirective: string;
      kind: "shell-command";
      prompt: string;
    }
  | {
      kind: "show-context";
      question: string;
    };

export function getSubmissionIntent(message: string): SubmissionIntent | null {
  const question = message.trim();
  if (question.length === 0) {
    return null;
  }

  const invocation = parseLlmSlashCommandInvocation(question);
  const requestQuestion = invocation?.input ?? question;
  if (!canSubmitInvocation({ invocation, requestQuestion })) {
    return null;
  }

  if (invocation?.command.taskKind === "show-context") {
    return { kind: "show-context", question: requestQuestion };
  }

  if (invocation?.command.taskKind === "config") {
    return { kind: "config" };
  }

  if (invocation?.command.taskKind === "say") {
    return { kind: "say", text: requestQuestion };
  }

  if (invocation?.command.taskKind === "agent-ask") {
    return { kind: "agent-ask", prompt: requestQuestion };
  }

  if (invocation?.command.taskKind === "agent-edit") {
    return { kind: "agent-edit", prompt: requestQuestion };
  }

  if (invocation?.command.taskKind === "agent-skill") {
    return { kind: "agent-ask", prompt: question };
  }

  if (invocation?.command.taskKind === "shell-command") {
    return {
      commandDirective: invocation.command.promptDirective,
      kind: "shell-command",
      prompt: requestQuestion,
    };
  }

  return {
    allowedToolNames: invocation?.command.allowedToolNames,
    commandDirective: invocation?.command.promptDirective,
    kind: "llm-request",
    question: requestQuestion,
  };
}

function canSubmitInvocation({
  invocation,
  requestQuestion,
}: {
  invocation: LlmSlashCommandInvocation | null;
  requestQuestion: string;
}): boolean {
  return (
    requestQuestion.length > 0 ||
    invocation?.command.taskKind === "show-context" ||
    invocation?.command.taskKind === "agent-skill" ||
    invocation?.command.taskKind === "config" ||
    invocation?.command.taskKind === "say"
  );
}
