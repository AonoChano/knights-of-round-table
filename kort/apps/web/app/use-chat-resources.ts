"use client";

import { useState } from "react";

import { API_BASE } from "../components/models/api";
import type { ProviderProfile, ProviderSecretStatus } from "../components/models/types";
import { t } from "./locale";
import type { Locale } from "./locale";
import type {
  AgentView,
  ConversationListItem,
  DeveloperDiagnostics,
  LogLevel,
} from "./page-types";
import {
  DEFAULT_LOG_LEVEL,
  RequestTimeoutError,
  clientErrorMessage,
  fetchWithTimeout,
  logClientEvent,
} from "./page-utils";

export function useChatResources(locale: Locale) {
  const [providers, setProviders] = useState<ProviderProfile[]>([]);
  const [providerSecretStatus, setProviderSecretStatus] = useState<Record<string, ProviderSecretStatus>>({});
  const [agents, setAgents] = useState<AgentView[]>([]);
  const [agentsError, setAgentsError] = useState<string | null>(null);
  const [globalSkills, setGlobalSkills] = useState<string[]>([]);
  const [conversations, setConversations] = useState<ConversationListItem[]>([]);
  const [conversationsError, setConversationsError] = useState<string | null>(null);
  const [conversationsLoading, setConversationsLoading] = useState(true);
  const [providersLoading, setProvidersLoading] = useState(true);
  const [providerSecretsLoading, setProviderSecretsLoading] = useState(true);
  const [agentsLoading, setAgentsLoading] = useState(true);
  const [developerMode, setDeveloperMode] = useState(false);
  const [logLevel, setLogLevel] = useState<LogLevel>(DEFAULT_LOG_LEVEL);
  const [developerStatus, setDeveloperStatus] = useState<string | null>(null);
  const [developerDiagnostics, setDeveloperDiagnostics] = useState<DeveloperDiagnostics | null>(null);

  function clientLog(level: LogLevel, message: string, data?: Record<string, unknown>) {
    logClientEvent(developerMode, logLevel, level, message, data);
  }

  async function loadProviders() {
    try {
      const response = await fetchWithTimeout(`${API_BASE}/api/providers`, {}, 6000);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload = (await response.json()) as ProviderProfile[];
      setProviders(payload);
    } catch (error) {
      clientLog("debug", "provider profiles load failed", {
        error: clientErrorMessage(error, t(locale).ui.backendUnavailable),
      });
      setProviders([]);
    } finally {
      setProvidersLoading(false);
    }
  }

  async function loadProviderSecretStatuses() {
    try {
      const response = await fetchWithTimeout(`${API_BASE}/api/provider-secrets`, {}, 6000);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload = (await response.json()) as ProviderSecretStatus[];
      setProviderSecretStatus(Object.fromEntries(payload.map((item) => [item.provider_id, item])));
    } catch (error) {
      clientLog("debug", "provider secret status load failed", {
        error: clientErrorMessage(error, t(locale).ui.backendUnavailable),
      });
      setProviderSecretStatus({});
    } finally {
      setProviderSecretsLoading(false);
    }
  }

  async function loadAgents() {
    try {
      const response = await fetchWithTimeout(`${API_BASE}/api/agents`, {}, 6000);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload = (await response.json()) as AgentView[];
      setAgents(payload);
      setAgentsError(null);
    } catch (error) {
      setAgents([]);
      setAgentsError(error instanceof Error ? error.message : t(locale).ui.loadAgentsFailed);
    } finally {
      setAgentsLoading(false);
    }
  }

  async function loadSkills() {
    try {
      const response = await fetchWithTimeout(`${API_BASE}/api/skills`, {}, 6000);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload = (await response.json()) as string[];
      setGlobalSkills(payload);
    } catch (error) {
      clientLog("debug", "global skills load failed", {
        error: clientErrorMessage(error, t(locale).ui.backendUnavailable),
      });
      setGlobalSkills([]);
    }
  }

  async function loadDeveloperDiagnostics() {
    const copy = t(locale).ui;
    setDeveloperStatus(copy.loadingDiagnostics);
    clientLog("info", "developer diagnostics requested", { apiBase: API_BASE });
    try {
      const response = await fetchWithTimeout(`${API_BASE}/api/developer/runtime`, {}, 6000);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload = (await response.json()) as DeveloperDiagnostics;
      setDeveloperDiagnostics(payload);
      setDeveloperStatus(copy.diagnosticsUpdated);
      clientLog("debug", "developer diagnostics loaded", {
        conversationCount: payload.conversation_count,
        jobsRunning: payload.jobs_running,
        backendLogLevel: payload.log_level,
      });
    } catch (error) {
      const message =
        error instanceof RequestTimeoutError
          ? copy.requestTimedOut(Math.round(error.timeoutMs / 1000))
          : clientErrorMessage(error, copy.backendUnavailable);
      setDeveloperStatus(message);
      clientLog("error", "developer diagnostics failed", { error: message });
    }
  }

  async function updateServerLogLevel(level: LogLevel) {
    const copy = t(locale).ui;
    try {
      const response = await fetchWithTimeout(
        `${API_BASE}/api/developer/log-level`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ level: level.toUpperCase() }),
        },
        6000
      );
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload = (await response.json()) as { level: string };
      setDeveloperStatus(copy.logLevelSaved);
      setDeveloperDiagnostics((current) => current ? { ...current, log_level: payload.level } : current);
      clientLog("info", "server log level updated", { level: payload.level });
    } catch (error) {
      const message =
        error instanceof RequestTimeoutError
          ? copy.requestTimedOut(Math.round(error.timeoutMs / 1000))
          : clientErrorMessage(error, copy.backendUnavailable);
      setDeveloperStatus(copy.logLevelSaveFailed(message));
      clientLog("error", "server log level update failed", { error: message });
    }
  }

  async function createAgent(data: { name: string; nickname: string; role: string; provider_profile: string; model: string; system_prompt: string; allowed_global_skills: string[]; disabled_global_skills: string[]; priority: number }) {
    try {
      const response = await fetch(`${API_BASE}/api/agents`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (response.ok) await loadAgents();
      else setAgentsError(t(locale).ui.createAgentFailedHttp(response.status));
    } catch (error) {
      setAgentsError(error instanceof Error ? error.message : t(locale).ui.createAgentRequestFailed);
    }
  }

  async function updateAgent(name: string, data: Record<string, unknown>) {
    try {
      const response = await fetch(`${API_BASE}/api/agents/${name}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (response.ok) await loadAgents();
      else setAgentsError(t(locale).ui.updateAgentFailedHttp(response.status));
    } catch (error) {
      setAgentsError(error instanceof Error ? error.message : t(locale).ui.updateAgentRequestFailed);
    }
  }

  async function deleteAgent(name: string) {
    try {
      const response = await fetch(`${API_BASE}/api/agents/${name}`, { method: "DELETE" });
      if (response.ok) await loadAgents();
      else setAgentsError(t(locale).ui.deleteAgentFailedHttp(response.status));
    } catch (error) {
      setAgentsError(error instanceof Error ? error.message : t(locale).ui.deleteAgentRequestFailed);
    }
  }

  async function loadConversations() {
    const copy = t(locale).ui;
    setConversationsLoading(true);
    clientLog("info", "conversation history load started", { apiBase: API_BASE });
    try {
      const response = await fetchWithTimeout(`${API_BASE}/api/conversations`, {}, 6000);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload = (await response.json()) as ConversationListItem[];
      setConversations(payload);
      setConversationsError(null);
      clientLog("info", "conversation history load completed", { count: payload.length });
    } catch (error) {
      const message =
        error instanceof RequestTimeoutError
          ? copy.requestTimedOut(Math.round(error.timeoutMs / 1000))
          : clientErrorMessage(error, copy.backendUnavailable);
      setConversationsError(message);
      clientLog("error", "conversation history load failed", { error: message });
    } finally {
      setConversationsLoading(false);
    }
  }

  async function refreshModels() {
    await Promise.all([loadProviders(), loadProviderSecretStatuses()]);
  }

  return {
    providers,
    providerSecretStatus,
    agents,
    agentsError,
    globalSkills,
    conversations,
    conversationsError,
    conversationsLoading,
    providersLoading,
    providerSecretsLoading,
    agentsLoading,
    developerMode,
    logLevel,
    developerStatus,
    developerDiagnostics,
    setProviders,
    setProviderSecretStatus,
    setAgents,
    setAgentsError,
    setGlobalSkills,
    setConversations,
    setConversationsError,
    setConversationsLoading,
    setProvidersLoading,
    setProviderSecretsLoading,
    setAgentsLoading,
    setDeveloperMode,
    setLogLevel,
    setDeveloperStatus,
    setDeveloperDiagnostics,
    clientLog,
    loadProviders,
    loadProviderSecretStatuses,
    loadAgents,
    loadSkills,
    loadDeveloperDiagnostics,
    updateServerLogLevel,
    createAgent,
    updateAgent,
    deleteAgent,
    loadConversations,
    refreshModels,
  };
}

export type ChatResources = ReturnType<typeof useChatResources>;
