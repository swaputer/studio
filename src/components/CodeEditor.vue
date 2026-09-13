<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from "vue";
import { EditorState } from "@codemirror/state";
import { EditorView, drawSelection, highlightActiveLine, highlightActiveLineGutter, keymap, lineNumbers } from "@codemirror/view";
import { HighlightStyle, StreamLanguage, bracketMatching, syntaxHighlighting } from "@codemirror/language";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { tags } from "@lezer/highlight";

const props = defineProps<{ modelValue: string }>();
const emit = defineEmits<{ "update:modelValue": [value: string] }>();
const host = ref<HTMLElement | null>(null);
let view: EditorView | null = null;

const language = StreamLanguage.define({
  token(stream) {
    if (stream.eatSpace()) return null;
    if (stream.match("//")) { stream.skipToEnd(); return "comment"; }
    if (stream.match(/0x[0-9a-fA-F]+|\d+/)) return "number";
    if (stream.match(/\b(contract|interface|constructor|function|event|indexed|returns|view|external|internal|mapping|uint256|int256|bool|account|address|bytes32|if|else|while|for|return|require|revert|emit|true|false|call|staticcall|create)\b/)) return "keyword";
    if (stream.match(/\b(msg|tx|world|buy|block|gas|this)\b/)) return "variableName.special";
    if (stream.match(/[A-Za-z_][A-Za-z0-9_]*/)) return "variableName";
    if (stream.match(/=>|==|!=|<=|>=|&&|\|\||<<|>>|[=+\-*/%<>!~&|^]/)) return "operator";
    stream.next(); return null;
  }
});

const highlight = HighlightStyle.define([
  { tag: tags.keyword, color: "#ff5bd0" },
  { tag: tags.number, color: "#f5c15b" },
  { tag: tags.comment, color: "#676a73", fontStyle: "italic" },
  { tag: tags.operator, color: "#d9d9dd" },
  { tag: tags.special(tags.variableName), color: "#6fc7ff" },
  { tag: tags.variableName, color: "#eeeef1" }
]);

const theme = EditorView.theme({
  "&": { height: "100%", backgroundColor: "#100d11", color: "#f1ebef", fontSize: "13px" },
  ".cm-content": { padding: "15px 0 72px", caretColor: "#ff37c7", fontFamily: "var(--font-mono)", lineHeight: "1.66" },
  ".cm-line": { padding: "0 18px" },
  ".cm-gutters": { backgroundColor: "#100d11", color: "#665d65", borderRight: "1px solid rgba(236,220,233,.055)", paddingLeft: "7px", paddingRight: "4px" },
  ".cm-activeLine": { backgroundColor: "rgba(255,55,199,.035)" },
  ".cm-activeLineGutter": { backgroundColor: "transparent", color: "#fff" },
  ".cm-selectionBackground, &.cm-focused .cm-selectionBackground": { backgroundColor: "rgba(255,55,199,.22) !important" },
  ".cm-cursor": { borderLeftColor: "#ff37c7" },
  ".cm-scroller": { overflow: "auto", fontFamily: "var(--font-mono)" },
  "&.cm-focused": { outline: "none" }
});

onMounted(() => {
  if (!host.value) return;
  view = new EditorView({
    parent: host.value,
    state: EditorState.create({
      doc: props.modelValue,
      extensions: [
        lineNumbers(), highlightActiveLineGutter(), highlightActiveLine(), drawSelection(), history(), bracketMatching(),
        keymap.of([indentWithTab, ...defaultKeymap, ...historyKeymap]), language, syntaxHighlighting(highlight), theme,
        EditorView.lineWrapping,
        EditorView.updateListener.of((update) => { if (update.docChanged) emit("update:modelValue", update.state.doc.toString()); })
      ]
    })
  });
});

watch(() => props.modelValue, (next) => {
  if (!view || view.state.doc.toString() === next) return;
  view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: next } });
});

onBeforeUnmount(() => view?.destroy());
</script>

<template><div ref="host" class="code-editor" /></template>
