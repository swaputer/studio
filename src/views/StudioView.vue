<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import {
  Check, ChevronDown, Copy, FileCode2, Hammer, LoaderCircle, Monitor,
  Play, Plus, Rocket, Save, Terminal, Trash2, TriangleAlert
} from "@lucide/vue";
import CodeEditor from "@/components/CodeEditor.vue";
import { useWallet } from "@/composables/useWallet";
import { toast } from "@/composables/useToast";
import { NETWORK, PROTOCOL_EXPLORER_URL, TRANSACTION_CONFIRMATIONS } from "@/lib/config";
import { deployMiniContract, friendlyError, isTransactionStatusUnknown, readMiniContract, short, writeMiniContract } from "@/lib/protocol";
import {
  EMPTY_CONTRACT,
  STUDIO_TEMPLATES,
  compileStudioSource,
  encodeConstructorArguments,
  formatStudioError,
  parseScalar,
  type StudioBuild,
  type StudioFunction
} from "@/lib/studio";

type InspectorTab = "build" | "deploy" | "interact";
type BuildPhase = "idle" | "compiling" | "success" | "error";
type ConsoleTone = "default" | "success" | "error";
type ConsoleLink = { kind: "tx" | "address"; value: string; label?: string };
type ConsoleEntry = { message: string; time: string; tone: ConsoleTone; links?: ConsoleLink[] };
type StudioFile = { id: string; name: string; source: string; saved: boolean; templateId?: string };
type StoredFile = Omit<StudioFile, "saved"> & { saved?: boolean };
type StoredWorkspace = { files: StoredFile[]; activeFileId: string | null };
const LEGACY_STORAGE_KEY = "swaputer.studio.source.v1";
const WORKSPACE_STORAGE_KEY = "swaputer.studio.workspace.v2";
const confirmationLabel = `${TRANSACTION_CONFIRMATIONS} ${TRANSACTION_CONFIRMATIONS === 1 ? "confirmation" : "confirmations"}`;

function createFileId() {
  return `file-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function counterFile(source = STUDIO_TEMPLATES[0]!.source): StudioFile {
  return { id: createFileId(), name: STUDIO_TEMPLATES[0]!.fileName, source, saved: true, templateId: "counter" };
}

function loadWorkspace(): { files: StudioFile[]; activeFileId: string | null } {
  try {
    const raw = localStorage.getItem(WORKSPACE_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as StoredWorkspace;
      if (Array.isArray(parsed.files)) {
        const files = parsed.files
          .filter((file) => file && typeof file.id === "string" && typeof file.name === "string" && typeof file.source === "string")
          .map((file) => ({ ...file, saved: file.saved !== false }));
        const activeFileId = files.some((file) => file.id === parsed.activeFileId) ? parsed.activeFileId : files[0]?.id ?? null;
        return { files, activeFileId };
      }
    }
  } catch (cause) {
    console.warn("[studio] failed to restore workspace", cause);
  }

  let legacySource: string | undefined;
  try { legacySource = localStorage.getItem(LEGACY_STORAGE_KEY) || undefined; }
  catch (cause) { console.warn("[studio] failed to restore legacy source", cause); }
  const file = counterFile(legacySource);
  return { files: [file], activeFileId: file.id };
}

const initialWorkspace = loadWorkspace();
const wallet = useWallet();
const files = ref<StudioFile[]>(initialWorkspace.files);
const activeFileId = ref<string | null>(initialWorkspace.activeFileId);
const activeFile = computed(() => files.value.find((file) => file.id === activeFileId.value) ?? null);
const templateId = computed(() => activeFile.value?.templateId ?? "");
const fileName = computed({
  get: () => activeFile.value?.name ?? "No file open",
  set: (value: string) => { if (activeFile.value) activeFile.value.name = value; }
});
const source = computed({
  get: () => activeFile.value?.source ?? "",
  set: (value: string) => { if (activeFile.value) activeFile.value.source = value; }
});
const saved = computed({
  get: () => activeFile.value?.saved ?? true,
  set: (value: boolean) => { if (activeFile.value) activeFile.value.saved = value; }
});
const build = ref<StudioBuild | null>(null);
const buildPhase = ref<BuildPhase>("idle");
const buildError = ref<string | null>(null);
const inspectorTab = ref<InspectorTab>("deploy");
const consoleOpen = ref(true);
const constructorValues = ref<string[]>([]);
const byteGasLimit = ref("20000");
const deployPhase = ref<"idle" | "signing" | "pending" | "confirmed" | "unknown">("idle");
const targetId = ref("");
const deployment = ref<{ programId: string | null; transactionHash: string } | null>(null);
const functionArgs = ref<Record<string, string[]>>({});
const functionResults = ref<Record<string, string>>({});
const activeFunction = ref<string | null>(null);
const deploymentInFlight = ref(false);
const functionInFlight = ref(false);
const chainActionInFlight = ref(false);
const unresolvedTransactionHash = ref<string | null>(null);
const consoleEntries = ref<ConsoleEntry[]>([{ message: "Studio ready", time: new Date().toLocaleTimeString("en-GB", { hour12: false }), tone: "success" }]);
const desktopMedia = window.matchMedia("(min-width: 900px)");
const desktopSupported = ref(desktopMedia.matches);
let compileTimer: number | undefined;
let initialBuildReported = false;
let compileRun = 0;
let deployRun = 0;
let functionRun = 0;

const explorerUrl = PROTOCOL_EXPLORER_URL.replace(/\/$/, "");
function explorerTxUrl(hash: string) {
  return `${explorerUrl}/tx/${hash}`;
}
function explorerAddressUrl(address: string) {
  return `${explorerUrl}/address/${address}`;
}

function addConsole(message: string, tone: ConsoleTone = "default", transaction?: string | ConsoleLink[]) {
  const links = Array.isArray(transaction)
    ? transaction
    : transaction
      ? [{ kind: "tx" as const, value: transaction }]
      : [];
  consoleEntries.value.push({
    message,
    time: new Date().toLocaleTimeString("en-GB", { hour12: false }),
    tone,
    links
  });
}

function openInspector(tab: InspectorTab) {
  inspectorTab.value = tab;
}

const tabLabel = (tab: InspectorTab) => tab.charAt(0).toUpperCase() + tab.slice(1);
const defaultScalarValue = (type: string) => /^(u?int)/.test(type) ? "0" : type === "bool" ? "false" : "";

const encodedConstructor = computed(() => {
  if (!build.value) return { value: "0x", error: null as string | null };
  try { return { value: encodeConstructorArguments(build.value.constructorTypes, constructorValues.value), error: null }; }
  catch (cause) { return { value: "0x", error: friendlyError(cause) }; }
});
const deployed = computed(() => deployPhase.value === "confirmed"
  && deployment.value?.programId?.toLowerCase() === targetId.value.trim().toLowerCase());
const deploymentTransactionUrl = computed(() => deployment.value
  ? `${PROTOCOL_EXPLORER_URL.replace(/\/$/, "")}/tx/${deployment.value.transactionHash}`
  : "");
const unresolvedTransactionUrl = computed(() => unresolvedTransactionHash.value
  ? `${PROTOCOL_EXPLORER_URL.replace(/\/$/, "")}/tx/${unresolvedTransactionHash.value}`
  : "");

async function compile(foreground = true) {
  if (!activeFile.value) {
    build.value = null;
    buildPhase.value = "idle";
    buildError.value = null;
    if (foreground) toast.error("Create or open a file before compiling.");
    return;
  }
  const run = ++compileRun;
  const compilingFileId = activeFileId.value;
  const compilingSource = source.value;
  const compilingFileName = fileName.value;
  if (foreground) window.clearTimeout(compileTimer);
  buildPhase.value = "compiling";
  try {
    const result = await compileStudioSource(compilingSource, compilingFileName);
    if (run !== compileRun || compilingFileId !== activeFileId.value || compilingSource !== source.value) return;
    build.value = result;
    buildPhase.value = "success";
    buildError.value = null;
    constructorValues.value = result.constructorTypes.map((type, index) => constructorValues.value[index] ?? defaultScalarValue(type));
    functionArgs.value = Object.fromEntries(result.functions.map((fn) => [
      fn.selector,
      fn.inputs.map((type, index) => functionArgs.value[fn.selector]?.[index] ?? defaultScalarValue(type))
    ]));
    if (foreground) addConsole(`Build succeeded · ${result.packageLength} package bytes`, "success");
    else if (!initialBuildReported) {
      addConsole(`Compiling ${fileName.value}…`);
      addConsole(`Build succeeded · ${result.packageLength} package bytes`, "success");
      initialBuildReported = true;
    }
  } catch (cause) {
    if (run !== compileRun || compilingFileId !== activeFileId.value) return;
    console.error("[studio] compilation failed", cause);
    const message = await formatStudioError(cause);
    if (run !== compileRun || compilingFileId !== activeFileId.value) return;
    build.value = null;
    buildPhase.value = "error";
    buildError.value = message;
    if (foreground) addConsole("Build failed", "error");
  }
}

function chooseTemplate(id: string) {
  const template = STUDIO_TEMPLATES.find((item) => item.id === id);
  if (!template) return;
  let file = files.value.find((item) => item.templateId === id);
  if (!file) {
    file = { id: createFileId(), name: template.fileName, source: template.source, saved: false, templateId: id };
    files.value.push(file);
  }
  activeFileId.value = file.id;
  persistWorkspace();
}

function newFile() {
  let index = 1;
  let name = "my-contract.tsol";
  const names = new Set(files.value.map((file) => file.name));
  while (names.has(name)) name = `my-contract-${++index}.tsol`;
  const file: StudioFile = { id: createFileId(), name, source: EMPTY_CONTRACT, saved: false };
  files.value.push(file);
  activeFileId.value = file.id;
  persistWorkspace();
  addConsole(`Created ${name}`);
}

function selectFile(id: string) {
  if (!files.value.some((file) => file.id === id) || activeFileId.value === id) return;
  activeFileId.value = id;
  persistWorkspace();
}

function persistWorkspace(): boolean {
  const workspace: StoredWorkspace = {
    activeFileId: activeFileId.value,
    files: files.value.map((file) => ({ ...file }))
  };
  try {
    localStorage.setItem(WORKSPACE_STORAGE_KEY, JSON.stringify(workspace));
    return true;
  } catch (cause) {
    console.warn("[studio] failed to save workspace", cause);
    toast.error("Studio could not save this workspace in the browser.");
    return false;
  }
}

function deleteFile(id: string) {
  const index = files.value.findIndex((file) => file.id === id);
  if (index < 0) return;
  const [removed] = files.value.splice(index, 1);
  if (activeFileId.value === id) {
    window.clearTimeout(compileTimer);
    compileRun += 1;
    activeFileId.value = files.value[index]?.id ?? files.value[index - 1]?.id ?? null;
    build.value = null;
    buildPhase.value = "idle";
    buildError.value = null;
  }
  persistWorkspace();
  addConsole(`Deleted ${removed!.name}`);
  toast.success(`${removed!.name} deleted.`);
}

function save() {
  if (!activeFile.value) return;
  const previouslySaved = saved.value;
  saved.value = true;
  if (!persistWorkspace()) {
    saved.value = previouslySaved;
    return;
  }
  addConsole("Saved locally", "success");
}

async function deploy() {
  if (deploymentInFlight.value || functionInFlight.value || chainActionInFlight.value) return;
  if (!wallet.address.value || !wallet.signer.value) {
    await wallet.connect();
    return;
  }
  if (!wallet.networkSupported.value) {
    await wallet.switchNetwork();
    return;
  }
  if (!build.value) { await compile(); return; }
  if (encodedConstructor.value.error) { toast.error(encodedConstructor.value.error); return; }
  const limit = Number(byteGasLimit.value);
  if (!Number.isInteger(limit) || limit <= 0) { toast.error("Enter a valid byte gas limit."); return; }
  const run = deployRun;
  const session = wallet.session.value;
  const signer = wallet.signer.value;
  const address = wallet.address.value;
  const compiled = build.value;
  const constructorData = encodedConstructor.value.value;
  deploymentInFlight.value = true;
  chainActionInFlight.value = true;
  unresolvedTransactionHash.value = null;
  deployment.value = null;
  deployPhase.value = "signing";
  addConsole("Waiting for deployment signature");
  let keepChainLock = false;
  try {
    const result = await deployMiniContract(
      signer,
      address,
      compiled.packageBytes,
      constructorData,
      limit,
      (hash: string) => {
        deployPhase.value = "pending";
        addConsole("Deployment submitted", "default", hash);
      }
    );
    const current = run === deployRun && session === wallet.session.value;
    const programId = result.confirmedProgramId;
    deployment.value = { programId, transactionHash: result.receipt.hash };
    if (current && programId) {
      targetId.value = programId;
      deployPhase.value = "confirmed";
      openInspector("interact");
      addConsole("Deployment confirmed", "success", result.receipt.hash);
      toast.success("Mini contract deployed.");
    } else if (current) {
      keepChainLock = true;
      chainActionInFlight.value = true;
      unresolvedTransactionHash.value = result.receipt.hash;
      deployPhase.value = "unknown";
      openInspector("interact");
      addConsole("Deployment transaction confirmed, but its address could not be decoded", "error", result.receipt.hash);
      toast.success("Deployment confirmed. Verify its address in Explorer before retrying.");
    } else {
      if (programId) deployPhase.value = "idle";
      else {
        keepChainLock = true;
        chainActionInFlight.value = true;
        unresolvedTransactionHash.value = result.receipt.hash;
        deployPhase.value = "unknown";
      }
        addConsole("Deployment confirmed for a previous editor or wallet context", "success", programId ? [] : result.receipt.hash);
      toast.success("A previously started deployment was confirmed.");
    }
  } catch (cause) {
    if (isTransactionStatusUnknown(cause)) {
      keepChainLock = true;
      unresolvedTransactionHash.value = cause.transactionHash;
      deployPhase.value = "unknown";
      deployment.value = { programId: null, transactionHash: cause.transactionHash };
      toast.error(friendlyError(cause));
      addConsole("Deployment status unknown. Check Explorer before retrying", "error", cause.transactionHash);
    } else {
      deployPhase.value = "idle";
      toast.error(friendlyError(cause));
      addConsole("Deployment failed", "error");
    }
  } finally {
    deploymentInFlight.value = false;
    if (!keepChainLock) chainActionInFlight.value = false;
  }
}

function parsedArgs(fn: StudioFunction): unknown[] {
  const values = functionArgs.value[fn.selector] ?? [];
  return fn.inputs.map((type, index) => parseScalar(type, values[index] ?? ""));
}

async function invoke(fn: StudioFunction) {
  if (functionInFlight.value || deploymentInFlight.value) return;
  if (!build.value) return;
  if (!/^0x[0-9a-fA-F]{64}$/.test(targetId.value.trim())) {
    functionResults.value[fn.selector] = "Enter a valid 32-byte address.";
    return;
  }
  if (wallet.address.value && !wallet.networkSupported.value) {
    await wallet.switchNetwork();
    return;
  }
  if (!fn.view && (!wallet.address.value || !wallet.signer.value)) {
    await wallet.connect();
    if (wallet.address.value && wallet.signer.value) {
      functionResults.value[fn.selector] = "Wallet connected. Send the transaction again.";
    }
    return;
  }
  if (!fn.view && chainActionInFlight.value) return;
  const run = functionRun;
  const session = wallet.session.value;
  const target = targetId.value.trim();
  const signer = wallet.signer.value;
  const address = wallet.address.value;
  functionInFlight.value = true;
  if (!fn.view) chainActionInFlight.value = true;
  if (!fn.view) unresolvedTransactionHash.value = null;
  activeFunction.value = fn.selector;
  functionResults.value[fn.selector] = fn.view ? "Calling…" : "Preparing transaction…";
  let keepChainLock = false;
  const isCurrent = () => run === functionRun
    && session === wallet.session.value
    && target === targetId.value.trim();
  try {
    const args = parsedArgs(fn);
    if (fn.view) {
      const result = await readMiniContract(target, fn.signature, fn.inputs, fn.outputs, args, wallet.address.value, wallet.provider.value ?? undefined);
      if (!isCurrent()) return;
      functionResults.value[fn.selector] = result.values.length ? result.values.join(", ") : `Success · ${result.bytesUsed} bytes used`;
      addConsole(`${fn.signature} called`, "success");
    } else {
      const receipt = await writeMiniContract(signer!, address!, target, fn.signature, fn.inputs, args, Number(byteGasLimit.value), (hash: string) => {
        addConsole(`${fn.signature} submitted`, "default", hash);
        if (isCurrent()) functionResults.value[fn.selector] = `Finalizing · ${confirmationLabel} · ${short(hash, 10, 8)}`;
      });
      if (isCurrent()) {
        functionResults.value[fn.selector] = `Confirmed · block ${receipt.blockNumber}`;
        addConsole(`${fn.signature} confirmed`, "success", receipt.hash);
      } else {
        addConsole(`${fn.signature} confirmed for a previous target or wallet context`, "success", receipt.hash);
      }
    }
  } catch (cause) {
    if (isTransactionStatusUnknown(cause)) {
      keepChainLock = true;
      unresolvedTransactionHash.value = cause.transactionHash;
      if (isCurrent()) functionResults.value[fn.selector] = friendlyError(cause);
      addConsole(`${fn.signature} status unknown. Check Explorer before retrying`, "error", cause.transactionHash);
    } else {
      if (isCurrent()) functionResults.value[fn.selector] = friendlyError(cause);
      addConsole(`${fn.signature} failed`, "error");
    }
  } finally {
    functionInFlight.value = false;
    if (!fn.view && !keepChainLock) chainActionInFlight.value = false;
    activeFunction.value = null;
  }
}

async function copy(value: string) {
  try { await navigator.clipboard.writeText(value); }
  catch { toast.error("Could not copy. Select the value and copy it manually."); }
}

watch([activeFileId, source], ([currentId, currentSource], [previousId, previousSource]) => {
  window.clearTimeout(compileTimer);
  compileRun += 1;
  deployRun += 1;
  functionRun += 1;
  if (!activeFile.value) {
    build.value = null;
    buildPhase.value = "idle";
    buildError.value = null;
    constructorValues.value = [];
    functionArgs.value = {};
    functionResults.value = {};
    if (!deploymentInFlight.value && deployPhase.value !== "unknown") {
      deployPhase.value = "idle";
      deployment.value = null;
    }
    if (!functionInFlight.value) activeFunction.value = null;
    targetId.value = "";
    return;
  }
  if (currentId === previousId && currentSource !== previousSource) saved.value = false;
  build.value = null;
  buildPhase.value = "idle";
  buildError.value = null;
  constructorValues.value = [];
  functionArgs.value = {};
  functionResults.value = {};
  if (!deploymentInFlight.value && deployPhase.value !== "unknown") {
    deployPhase.value = "idle";
    deployment.value = null;
  }
  if (!functionInFlight.value) activeFunction.value = null;
  if (currentId !== previousId) targetId.value = "";
  if (!desktopSupported.value) return;
  compileTimer = window.setTimeout(() => void compile(false), 700);
});

watch(wallet.session, () => {
  deployRun += 1;
  functionRun += 1;
  functionResults.value = {};
  if (!deploymentInFlight.value && deployPhase.value !== "unknown" && (deployPhase.value === "signing" || deployPhase.value === "pending")) deployPhase.value = "idle";
  if (!functionInFlight.value) activeFunction.value = null;
});

watch(targetId, () => {
  functionRun += 1;
  functionResults.value = {};
}, { flush: "sync" });

watch(functionArgs, () => {
  functionRun += 1;
  functionResults.value = {};
}, { deep: true, flush: "sync" });

watch(constructorValues, () => { deployRun += 1; }, { deep: true, flush: "sync" });
watch(byteGasLimit, () => {
  deployRun += 1;
  functionRun += 1;
  functionResults.value = {};
}, { flush: "sync" });

function syncDesktopSupport(event: MediaQueryListEvent | MediaQueryList) {
  desktopSupported.value = event.matches;
  if (event.matches && activeFile.value && !build.value) void compile(false);
}

onMounted(() => {
  desktopMedia.addEventListener("change", syncDesktopSupport);
  if (desktopSupported.value && activeFile.value) void compile(false);
});
onBeforeUnmount(() => {
  desktopMedia.removeEventListener("change", syncDesktopSupport);
  window.clearTimeout(compileTimer);
});
</script>

<template>
  <main class="studio-page">
    <section v-if="!desktopSupported" class="studio-mobile-gate">
      <Monitor :size="34" aria-hidden="true" />
      <h1>Open Studio on a computer</h1>
      <p>Swaputer Studio is designed for desktop browsers. Please visit this address from a PC or Mac to write, compile and deploy Mini Contracts.</p>
      <a :href="PROTOCOL_EXPLORER_URL">Return to Explorer</a>
    </section>

    <section v-else class="studio-desktop">
      <div v-if="wallet.address.value && !wallet.networkSupported.value" class="studio-network-warning" role="alert">
        <span><TriangleAlert :size="16" />This network is not supported by Swaputer Studio.</span>
        <button type="button" :disabled="wallet.connecting.value" @click="wallet.switchNetwork">Switch to {{ NETWORK.displayName }}</button>
      </div>
      <div class="studio-workspace">
        <aside class="studio-explorer">
          <div class="studio-product-title"><strong>Files</strong><button type="button" title="New file" aria-label="New file" @click="newFile"><Plus :size="17" /></button></div>
          <h2>TEMPLATES</h2>
          <button v-for="template in STUDIO_TEMPLATES" :key="template.id" type="button" :class="{ active: templateId === template.id }" @click="chooseTemplate(template.id)"><FileCode2 :size="17" /><span><strong>{{ template.name }}</strong><small>{{ template.description }}</small></span></button>
          <div class="explorer-rule" />
          <h2>FILES</h2>
          <div v-for="file in files" :key="file.id" :class="['studio-file-row', { active: activeFileId === file.id }]">
            <button class="studio-file-main" type="button" @click="selectFile(file.id)"><FileCode2 :size="17" /><span><strong>{{ file.name }}</strong><small v-if="!file.saved">Unsaved</small></span></button>
            <button class="studio-file-delete" type="button" :title="`Delete ${file.name}`" :aria-label="`Delete ${file.name}`" @click.stop="deleteFile(file.id)"><Trash2 :size="14" /></button>
          </div>
          <p v-if="!files.length" class="studio-files-empty">No files. Create a file or open the Counter template.</p>
          <button class="new-file" type="button" @click="newFile"><Plus :size="18" />New file</button>
        </aside>

        <section :class="['studio-editor-column', { 'console-collapsed': !consoleOpen }]">
          <div class="editor-toolbar">
            <div :class="['editor-file-tab', { 'editor-file-tab--empty': !activeFile }]"><FileCode2 :size="16" /><span>{{ fileName }}</span><i v-if="activeFile && !saved" title="Unsaved changes" /></div>
            <div class="editor-toolbar__actions">
              <button type="button" :disabled="!activeFile" class="save-button" :class="{ dirty: activeFile && !saved }" @click="save">
                <Check v-if="saved" :size="14" />
                <Save v-else :size="16" />
                {{ activeFile ? (saved ? "Saved" : "Save") : "Save" }}
              </button>
              <button class="compile-button" type="button" :disabled="!activeFile || buildPhase === 'compiling'" @click="compile()"><LoaderCircle v-if="buildPhase === 'compiling'" class="spin" :size="16" /><Play v-else :size="15" fill="currentColor" />Compile</button>
              <div :class="['editor-build-state', `editor-build-state--${buildPhase}`]">
                <i /><span>{{ buildPhase === 'success' ? 'Compiled successfully' : buildPhase === 'compiling' ? 'Compiling source' : buildPhase === 'error' ? 'Build failed' : 'Ready to compile' }}</span>
              </div>
            </div>
          </div>
          <CodeEditor v-if="activeFile" :key="activeFile.id" v-model="source" />
          <div v-else class="studio-editor-empty"><FileCode2 :size="30" /><strong>No file open</strong><span>Create a new TinySol file or open the Counter template.</span><button type="button" @click="newFile"><Plus :size="16" />New file</button></div>
          <div class="studio-console">
            <header><span><Terminal :size="14" />Console</span><div><button type="button" @click="consoleEntries = []">Clear</button><button type="button" :aria-label="consoleOpen ? 'Collapse console' : 'Expand console'" @click="consoleOpen = !consoleOpen"><ChevronDown :class="{ 'console-chevron--open': consoleOpen }" :size="16" /></button></div></header>
            <div v-show="consoleOpen">
              <p v-for="(entry, index) in consoleEntries.slice(-6)" :key="`${entry.time}-${entry.message}-${index}`" :class="`console-entry--${entry.tone}`">
                <span class="console-entry__time">[{{ entry.time }}]</span><Check v-if="entry.tone === 'success'" :size="13" /><TriangleAlert v-else-if="entry.tone === 'error'" :size="13" />
                <span>{{ entry.message }}</span>
                <template v-for="(link, linkIndex) in entry.links ?? []" :key="`${entry.time}-${link.value}-${linkIndex}`">
                  <a v-if="link.kind === 'tx'" class="console-entry__link" :href="explorerTxUrl(link.value)" target="_blank" rel="noreferrer" :title="link.value">
                    {{ short(link.label ?? link.value, 10, 8) }}
                  </a>
                  <a v-else class="console-entry__link" :href="explorerAddressUrl(link.value)" target="_blank" rel="noreferrer" :title="link.value">
                    {{ short(link.label ?? link.value, 10, 8) }}
                  </a>
                </template>
              </p>
              <p v-if="!consoleEntries.length" class="console-entry--empty">No console output.</p>
            </div>
          </div>
        </section>

        <aside class="studio-inspector">
          <nav>
            <button v-for="tab in (['build','deploy','interact'] as InspectorTab[])" :key="tab" type="button" :class="{ active: inspectorTab === tab }" @click="openInspector(tab)">{{ tabLabel(tab) }}</button>
          </nav>
          <a v-if="unresolvedTransactionHash" class="inspector-recovery" :href="unresolvedTransactionUrl" target="_blank" rel="noreferrer">Confirmation unknown · verify transaction in Explorer</a>

          <div v-if="inspectorTab === 'build'" class="inspector-body">
            <div :class="['build-banner', `build-banner--${buildPhase}`]">
              <Check v-if="buildPhase === 'success'" :size="21" />
              <LoaderCircle v-else-if="buildPhase === 'compiling'" class="spin" :size="21" />
              <TriangleAlert v-else-if="buildPhase === 'error'" :size="21" />
              <span><strong>{{ buildPhase === 'success' ? 'Build succeeded' : buildPhase === 'compiling' ? 'Compiling' : buildPhase === 'error' ? 'Build failed' : 'Ready to build' }}</strong><small>{{ buildError || (build ? `${build.functions.length} external functions` : 'Compile the current source') }}</small></span>
            </div>
            <dl class="inspector-metrics">
              <div><dt>Code size</dt><dd>{{ build ? `${build.codeLength} B` : '—' }}</dd></div>
              <div><dt>Package size</dt><dd>{{ build ? `${build.packageLength} B` : '—' }}</dd></div>
              <div><dt>Functions</dt><dd>{{ build?.functions.length ?? '—' }}</dd></div>
              <div><dt>Constructor</dt><dd>{{ build?.constructorTypes.length ? `${build.constructorTypes.length} args` : 'none' }}</dd></div>
            </dl>
            <div class="hash-block"><span>Package hash</span><code>{{ build ? short(build.codeHash, 18, 14) : '—' }}</code><button type="button" :disabled="!build" @click="build && copy(build.codeHash)"><Copy :size="15" /></button></div>
            <div class="function-index"><h3>Functions</h3><div v-for="fn in build?.functions" :key="fn.selector"><code>{{ fn.signature }}</code><span>{{ fn.view ? 'read' : 'write' }}</span></div></div>
            <button class="inspector-primary" type="button" :disabled="!build" @click="openInspector('deploy')">Continue to deploy</button>
          </div>

          <div v-else-if="inspectorTab === 'deploy'" class="inspector-body deploy-panel">
            <div class="panel-intro"><h2>{{ build?.contractName || 'Compile first' }}</h2><p>Constructor arguments are encoded from the compiled ABI.</p></div>
            <div v-if="build?.constructorTypes.length" class="constructor-fields">
              <label v-for="(type, index) in build.constructorTypes" :key="`${type}-${index}`"><span>{{ index === 0 ? `Constructor · ${build.constructorNames[index]}` : build.constructorNames[index] }}</span><small>{{ type }}</small><input v-model="constructorValues[index]" :placeholder="type" spellcheck="false" /></label>
            </div>
            <p v-else class="no-constructor">This contract has no constructor arguments.</p>
            <label class="encoded-args"><span>Encoded constructor data</span><textarea :value="encodedConstructor.error || encodedConstructor.value" readonly /></label>
            <label class="gas-input"><span>Byte gas limit</span><input v-model="byteGasLimit" inputmode="numeric" /></label>
            <dl class="deploy-summary"><div><dt>Network</dt><dd>{{ wallet.networkLabel.value }}</dd></div><div><dt>Wallet</dt><dd>{{ wallet.address.value ? short(wallet.address.value) : 'Not connected' }}</dd></div></dl>
            <button class="inspector-primary" type="button" :disabled="deploymentInFlight || functionInFlight || chainActionInFlight || !build" @click="deploy"><LoaderCircle v-if="deploymentInFlight" class="spin" :size="17" />{{ !wallet.address.value ? 'Connect wallet' : !wallet.networkSupported.value ? 'Switch network' : deployPhase === 'signing' ? 'Confirm signature' : deployPhase === 'pending' ? `Finalizing · ${confirmationLabel}` : deployPhase === 'unknown' ? 'Check in Explorer' : 'Deploy contract' }}</button>
          </div>

          <div v-else class="inspector-body interact-panel">
            <div class="status-strip"><span><Check :size="15" />{{ buildPhase === 'success' ? `Build passed · ${build?.codeLength} B` : 'Build required' }}</span><span><Check v-if="deployed" :size="15" />{{ deployed ? `Deployed · ${wallet.networkLabel.value}` : 'Address required' }}</span></div>
            <label class="target-input"><span>ADDRESS</span><div><input v-model="targetId" spellcheck="false" placeholder="0x…" /><button type="button" :disabled="!targetId" aria-label="Copy address" @click="copy(targetId)"><Copy :size="15" /></button></div></label>
            <a v-if="deployment" :href="deploymentTransactionUrl" target="_blank" rel="noreferrer">View deployment transaction</a>
            <div v-if="!build" class="interact-empty">Compile the matching source to generate the contract interaction form.</div>
            <section v-for="fn in build?.functions" :key="fn.selector" class="function-card">
              <header><span>{{ fn.view ? 'READ' : 'WRITE' }}</span><code>{{ fn.signature }}</code></header>
              <label v-for="(type, index) in fn.inputs" :key="`${fn.selector}-${index}`"><span>{{ fn.inputNames[index] }}</span><small>{{ type }}</small><input v-model="functionArgs[fn.selector]![index]" :placeholder="type" spellcheck="false" /></label>
              <button :class="{ primary: !fn.view }" type="button" :disabled="functionInFlight || deploymentInFlight || (!fn.view && chainActionInFlight)" @click="invoke(fn)"><LoaderCircle v-if="activeFunction === fn.selector" class="spin" :size="15" />{{ wallet.address.value && !wallet.networkSupported.value ? 'Switch network' : fn.view ? 'Call' : 'Send transaction' }}</button>
              <output v-if="functionResults[fn.selector]">{{ functionResults[fn.selector] }}</output>
            </section>
          </div>
        </aside>
      </div>

      <footer class="studio-statusbar"><span>TinySol {{ build?.languageVersion ?? '1.1' }} · compiler {{ build?.compilerVersion ?? '0.4.0' }}</span><span>{{ fileName }}</span><span>Spaces: 2</span><span>UTF-8</span><span><i />{{ buildPhase === 'error' ? 'Build error' : buildPhase === 'compiling' ? 'Compiling' : 'Ready' }}</span></footer>
    </section>
  </main>
</template>
