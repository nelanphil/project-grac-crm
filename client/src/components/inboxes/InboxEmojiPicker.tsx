"use client";

import EmojiPicker, { type EmojiClickData } from "emoji-picker-react";

type InboxEmojiPickerProps = {
  onPick: (emoji: string) => void;
};

function pickerTheme(): "dark" | "light" {
  if (typeof document === "undefined") return "dark";
  return document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light";
}

export default function InboxEmojiPicker({ onPick }: InboxEmojiPickerProps) {
  return (
    <EmojiPicker
      theme={pickerTheme()}
      emojiStyle="native"
      lazyLoadEmojis
      autoFocusSearch={false}
      reactionsDefaultOpen={false}
      searchPlaceHolder="Search emoji"
      previewConfig={{ showPreview: false }}
      width={300}
      height={340}
      onEmojiClick={(emoji: EmojiClickData) => onPick(emoji.emoji)}
    />
  );
}
