import type { ReactNode } from "react";

export type MenuStepItem = {
  key: string;
  label: string;
};

type MenuStepProps = {
  description?: string;
  extraContent?: ReactNode;
  items: readonly MenuStepItem[];
  message?: string | null;
  messageColor?: "gray" | "red" | "yellow";
  selectedIndex: number;
  statusText?: string;
  title?: string;
};

const selectedStyle = { bg: "blue", fg: "white" } as const;

export function MenuStep({
  description,
  extraContent,
  items,
  message = null,
  messageColor = "yellow",
  selectedIndex,
  statusText,
  title,
}: MenuStepProps) {
  return (
    <>
      {title === undefined ? null : <text>{title}</text>}
      {description === undefined ? null : <text>{description}</text>}
      {statusText === undefined ? null : (
        <text style={{ fg: "gray" }}>{statusText}</text>
      )}
      {extraContent}
      {items.map((item, index) => (
        <text
          key={item.key}
          style={index === selectedIndex ? selectedStyle : undefined}
        >
          {`${index === selectedIndex ? ">" : " "} ${item.label}`}
        </text>
      ))}
      {message === null ? null : (
        <text style={{ fg: messageColor }}>{message}</text>
      )}
    </>
  );
}
