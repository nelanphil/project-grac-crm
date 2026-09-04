"use client";

import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { TextStyle, Color } from "@tiptap/extension-text-style";
import TextAlign from "@tiptap/extension-text-align";
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Bold,
  Italic,
  Link2,
  List,
  ListOrdered,
  Redo2,
  RemoveFormatting,
  Smile,
  Strikethrough,
  Underline as UnderlineIcon,
  Undo2,
} from "lucide-react";

const CHAT_SYMBOLS: { label: string; chars: string[] }[] = [
  {
    label: "Faces",
    chars: [
      "😀", "😃", "😄", "😁", "😆", "😅", "😂", "🤣", "😊", "🙂",
      "😉", "😍", "😘", "😜", "🤪", "😎", "🤓", "🥳", "😇", "🤗",
      "🤔", "😐", "😏", "😒", "😞", "😔", "😢", "😭", "😤", "😡",
      "😱", "😴", "😷", "🤒",
    ],
  },
  {
    label: "Gestures",
    chars: [
      "👍", "👎", "👏", "🙌", "🙏", "👋", "🤝", "💪", "✌️", "🤞",
      "👌", "👉", "👇", "👀",
    ],
  },
  {
    label: "Symbols",
    chars: [
      "❤️", "🧡", "💛", "💚", "💙", "💜", "🖤", "🤍", "🔥", "⭐",
      "✨", "🎉", "💯", "✅", "❌", "⚠️", "💡", "📌", "📅", "⏰",
      "📧", "✔️", "→", "•", "—", "…",
    ],
  },
];

const EMAIL_BODY_MAX = 25_000;

export type EmailBodyEditorHandle = {
  insertText: (text: string) => void;
  focus: () => void;
};

type EmailBodyEditorProps = {
  value: string;
  onChange: (html: string) => void;
  placeholder?: string;
  maxLength?: number;
};

function ToolbarButton({
  active,
  disabled,
  onClick,
  title,
  children,
}: {
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
  title: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      onClick={onClick}
      className={`inline-flex h-8 w-8 items-center justify-center rounded-md text-sm disabled:opacity-40 ${
        active
          ? "bg-brand-dark text-white"
          : "text-neutral-600 hover:bg-neutral-100 hover:text-brand-dark"
      }`}
    >
      {children}
    </button>
  );
}

function EmojiPicker({ onPick }: { onPick: (char: string) => void }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDocClick(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);

  return (
    <div ref={rootRef} className="relative">
      <ToolbarButton
        title="Emoji and symbols"
        active={open}
        onClick={() => setOpen((value) => !value)}
      >
        <Smile className="h-3.5 w-3.5" />
      </ToolbarButton>
      {open ? (
        <div className="absolute left-0 top-9 z-20 w-[260px] rounded-lg border border-neutral-200 bg-white p-2 shadow-lg">
          <div className="max-h-56 space-y-2 overflow-y-auto">
            {CHAT_SYMBOLS.map((group) => (
              <div key={group.label}>
                <p className="mb-1 px-0.5 text-[10px] font-semibold uppercase tracking-wide text-neutral-400">
                  {group.label}
                </p>
                <div className="flex flex-wrap gap-0.5">
                  {group.chars.map((char) => (
                    <button
                      key={char}
                      type="button"
                      title={char}
                      onClick={() => {
                        onPick(char);
                        setOpen(false);
                      }}
                      className="flex h-7 w-7 items-center justify-center rounded text-base hover:bg-neutral-100"
                    >
                      {char}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

const EmailBodyEditor = forwardRef<EmailBodyEditorHandle, EmailBodyEditorProps>(
  function EmailBodyEditor(
    {
      value,
      onChange,
      placeholder = "Write your email…",
      maxLength = EMAIL_BODY_MAX,
    },
    ref,
  ) {
    const editor = useEditor({
      immediatelyRender: false,
      shouldRerenderOnTransaction: true,
      extensions: [
        StarterKit.configure({
          heading: { levels: [2, 3] },
          link: {
            openOnClick: false,
            defaultProtocol: "https",
            HTMLAttributes: { rel: "noopener noreferrer", target: "_blank" },
          },
        }),
        TextStyle,
        Color,
        TextAlign.configure({ types: ["heading", "paragraph"] }),
      ],
      content: value || "<p></p>",
      editorProps: {
        attributes: {
          class:
            "min-h-[180px] max-h-[420px] overflow-y-auto px-3 py-2 text-sm text-brand-dark outline-none [&_a]:text-brand-orange [&_a]:underline [&_ul]:ml-5 [&_ul]:list-disc [&_ol]:ml-5 [&_ol]:list-decimal [&_h2]:mb-2 [&_h2]:text-lg [&_h2]:font-semibold [&_h3]:mb-1 [&_h3]:text-base [&_h3]:font-semibold [&_p]:mb-2",
        },
      },
      onUpdate: ({ editor: next }) => {
        onChange(next.getHTML());
      },
    });

    useEffect(() => {
      if (!editor) return;
      const current = editor.getHTML();
      const next = value || "<p></p>";
      if (current !== next) {
        editor.commands.setContent(next, { emitUpdate: false });
      }
    }, [editor, value]);

    useImperativeHandle(
      ref,
      () => ({
        insertText(text: string) {
          if (!editor) return;
          editor.chain().focus().insertContent(text).run();
        },
        focus() {
          editor?.commands.focus();
        },
      }),
      [editor],
    );

    function setLink() {
      if (!editor) return;
      const previous = editor.getAttributes("link").href as string | undefined;
      const url = window.prompt("Link URL", previous ?? "https://");
      if (url === null) return;
      const trimmed = url.trim();
      if (!trimmed) {
        editor.chain().focus().unsetLink().run();
        return;
      }
      editor.chain().focus().setLink({ href: trimmed }).run();
    }

    const colorValue =
      (editor?.getAttributes("textStyle").color as string | undefined) ||
      "#231f20";

    return (
      <div>
        <div className="flex flex-wrap items-center gap-0.5 rounded-t-lg border border-b-0 border-neutral-300 bg-neutral-50 px-1.5 py-1">
          <ToolbarButton
            title="Undo"
            disabled={!editor?.can().undo()}
            onClick={() => editor?.chain().focus().undo().run()}
          >
            <Undo2 className="h-3.5 w-3.5" />
          </ToolbarButton>
          <ToolbarButton
            title="Redo"
            disabled={!editor?.can().redo()}
            onClick={() => editor?.chain().focus().redo().run()}
          >
            <Redo2 className="h-3.5 w-3.5" />
          </ToolbarButton>
          <span className="mx-1 h-4 w-px bg-neutral-200" />
          <ToolbarButton
            title="Bold"
            active={editor?.isActive("bold")}
            onClick={() => editor?.chain().focus().toggleBold().run()}
          >
            <Bold className="h-3.5 w-3.5" />
          </ToolbarButton>
          <ToolbarButton
            title="Italic"
            active={editor?.isActive("italic")}
            onClick={() => editor?.chain().focus().toggleItalic().run()}
          >
            <Italic className="h-3.5 w-3.5" />
          </ToolbarButton>
          <ToolbarButton
            title="Underline"
            active={editor?.isActive("underline")}
            onClick={() => editor?.chain().focus().toggleUnderline().run()}
          >
            <UnderlineIcon className="h-3.5 w-3.5" />
          </ToolbarButton>
          <ToolbarButton
            title="Strikethrough"
            active={editor?.isActive("strike")}
            onClick={() => editor?.chain().focus().toggleStrike().run()}
          >
            <Strikethrough className="h-3.5 w-3.5" />
          </ToolbarButton>
          <span className="mx-1 h-4 w-px bg-neutral-200" />
          <ToolbarButton
            title="Bulleted list"
            active={editor?.isActive("bulletList")}
            onClick={() => editor?.chain().focus().toggleBulletList().run()}
          >
            <List className="h-3.5 w-3.5" />
          </ToolbarButton>
          <ToolbarButton
            title="Numbered list"
            active={editor?.isActive("orderedList")}
            onClick={() => editor?.chain().focus().toggleOrderedList().run()}
          >
            <ListOrdered className="h-3.5 w-3.5" />
          </ToolbarButton>
          <span className="mx-1 h-4 w-px bg-neutral-200" />
          <ToolbarButton
            title="Align left"
            active={editor?.isActive({ textAlign: "left" })}
            onClick={() => editor?.chain().focus().setTextAlign("left").run()}
          >
            <AlignLeft className="h-3.5 w-3.5" />
          </ToolbarButton>
          <ToolbarButton
            title="Align center"
            active={editor?.isActive({ textAlign: "center" })}
            onClick={() => editor?.chain().focus().setTextAlign("center").run()}
          >
            <AlignCenter className="h-3.5 w-3.5" />
          </ToolbarButton>
          <ToolbarButton
            title="Align right"
            active={editor?.isActive({ textAlign: "right" })}
            onClick={() => editor?.chain().focus().setTextAlign("right").run()}
          >
            <AlignRight className="h-3.5 w-3.5" />
          </ToolbarButton>
          <span className="mx-1 h-4 w-px bg-neutral-200" />
          <label
            className="inline-flex h-8 items-center gap-1 rounded-md px-1.5 text-[11px] text-neutral-600 hover:bg-neutral-100"
            title="Text color"
          >
            <span
              className="h-3.5 w-3.5 rounded-sm border border-neutral-300"
              style={{ backgroundColor: colorValue }}
            />
            <input
              type="color"
              value={/^#[0-9a-fA-F]{6}$/.test(colorValue) ? colorValue : "#231f20"}
              onChange={(e) =>
                editor?.chain().focus().setColor(e.target.value).run()
              }
              className="h-0 w-0 opacity-0"
            />
          </label>
          <EmojiPicker
            onPick={(char) =>
              editor
                ?.chain()
                .focus()
                .insertContent({ type: "text", text: char })
                .run()
            }
          />
          <ToolbarButton
            title="Link"
            active={editor?.isActive("link")}
            onClick={setLink}
          >
            <Link2 className="h-3.5 w-3.5" />
          </ToolbarButton>
          <ToolbarButton
            title="Clear formatting"
            onClick={() =>
              editor?.chain().focus().unsetAllMarks().clearNodes().run()
            }
          >
            <RemoveFormatting className="h-3.5 w-3.5" />
          </ToolbarButton>
        </div>
        <div className="relative rounded-b-lg border border-neutral-300 focus-within:border-brand-orange">
          {!editor ? (
            <div className="min-h-[180px] px-3 py-2 text-sm text-neutral-400">
              {placeholder}
            </div>
          ) : (
            <EditorContent editor={editor} />
          )}
        </div>
        <p className="mt-1 text-right text-[11px] text-neutral-400">
          {value.length}/{maxLength}
        </p>
      </div>
    );
  },
);

export default EmailBodyEditor;
