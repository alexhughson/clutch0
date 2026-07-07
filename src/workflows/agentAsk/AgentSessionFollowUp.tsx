import type { KeyEvent } from "@opentui/core";
import { useState } from "react";
import { isEnterKey } from "../../lib/keymap";
import { sendAgentAskMessage } from "./agentAskSessionRegistry";

export function AgentSessionFollowUp({ itemId }: { itemId: string }) {
  const [message, setMessage] = useState("");

  return (
    <box style={{ height: 1 }}>
      <input
        value={message}
        placeholder="Send a follow-up to this agent session"
        focused
        onInput={setMessage}
        onKeyDown={(event: KeyEvent) => {
          if (!isEnterKey(event.name)) {
            return;
          }

          const nextMessage = message.trim();
          if (nextMessage.length === 0) {
            return;
          }

          event.preventDefault();
          event.stopPropagation();
          setMessage("");
          void sendAgentAskMessage({
            itemId,
            message: nextMessage,
          });
        }}
        style={{ width: "100%" }}
      />
    </box>
  );
}
