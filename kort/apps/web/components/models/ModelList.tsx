import { ChevronDown, MoreHorizontal, Pencil, Plus, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import type { ReactNode } from "react";

import type { Locale } from "../../app/locale";
import { t } from "../../app/locale";
import type { ModelsCopy } from "./copy";
import { ConfirmDialog } from "./ConfirmDialog";
import { modelsApi } from "./api";
import { ProfileIcon } from "./ProviderIcon";
import {
  configName,
  modelName,
  modelGroups,
  rowSubtitle,
  withModelEnabled,
  withoutModel,
  type ModelGroup,
  type ModelRow,
} from "./managed";
import { AddModelDialog, type KeySource } from "./AddModelDialog";
import type { ProviderProfile, ProviderSecretStatus } from "./types";

type DialogState = { mode: "create" } | { mode: "edit"; provider: ProviderProfile } | null;
type PendingDelete = { kind: "config"; group: ModelGroup } | { kind: "model"; row: ModelRow };

export function ModelList({
  providers,
  secretStatus,
  locale,
  onChanged,
}: {
  providers: ProviderProfile[];
  secretStatus: Record<string, ProviderSecretStatus>;
  locale: Locale;
  onChanged: () => Promise<void>;
}) {
  const copy = t(locale).models;
  const [dialog, setDialog] = useState<DialogState>(null);
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [pendingDelete, setPendingDelete] = useState<PendingDelete | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  const groups = modelGroups(providers);
  const modelCount = groups.reduce((total, group) => total + group.rows.length, 0);

  useEffect(() => {
    if (!openMenu) return;
    function dismiss() {
      setOpenMenu(null);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") dismiss();
    }
    document.addEventListener("click", dismiss);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("click", dismiss);
      document.removeEventListener("keydown", onKey);
    };
  }, [openMenu]);

  async function run(action: () => Promise<void>, success: string) {
    try {
      await action();
      await onChanged();
      setStatus(success);
    } catch (error) {
      setStatus(`${copy.failed}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  function toggleRow(row: ModelRow) {
    const next = !row.model.enabled;
    return run(
      async () => {
        await modelsApi.update(
          row.provider.provider_id,
          withModelEnabled(row.provider, row.model.id, next)
        );
      },
      copy.updatedToast
    );
  }

  function toggleGroup(providerId: string) {
    setCollapsed((current) => ({ ...current, [providerId]: !current[providerId] }));
  }

  function deletePending(pending: PendingDelete) {
    if (pending.kind === "config") {
      return run(async () => {
        await modelsApi.remove(pending.group.provider.provider_id);
        setPendingDelete(null);
      }, copy.configDeletedToast);
    }
    const row = pending.row;
    const remaining = withoutModel(row.provider, row.model.id);
    return run(
      async () => {
        if (remaining) {
          await modelsApi.update(row.provider.provider_id, remaining);
        } else {
          await modelsApi.remove(row.provider.provider_id);
        }
        setPendingDelete(null);
      },
      copy.deletedToast
    );
  }

  return (
    <div className="model-panel">
      <div className="model-panel-toolbar">
        <span className="model-panel-count">{copy.count(modelCount)}</span>
        <button
          type="button"
          className="small-button-primary small-button-icon"
          onClick={() => {
            setStatus(null);
            setDialog({ mode: "create" });
          }}
        >
          <Plus size={14} aria-hidden="true" />
          <span>{copy.add}</span>
        </button>
      </div>

      {modelCount === 0 ? (
        <div className="model-empty">{copy.empty}</div>
      ) : (
        <div className="model-groups">
          {groups.map((group) => (
            <ConfigGroup
              key={group.provider.provider_id}
              group={group}
              copy={copy}
              locale={locale}
              collapsed={Boolean(collapsed[group.provider.provider_id])}
              keyBadge={keyBadge(secretStatus[group.provider.provider_id], group.provider.env_key_name, copy)}
              openMenu={openMenu}
              onMenu={(key) => setOpenMenu(openMenu === key ? null : key)}
              onToggleCollapsed={() => toggleGroup(group.provider.provider_id)}
              onEdit={() => {
                setOpenMenu(null);
                setStatus(null);
                setDialog({ mode: "edit", provider: group.provider });
              }}
              onDeleteConfig={() => {
                setOpenMenu(null);
                setPendingDelete({ kind: "config", group });
              }}
              onToggleModel={(row) => void toggleRow(row)}
              onDeleteModel={(row) => {
                setOpenMenu(null);
                setPendingDelete({ kind: "model", row });
              }}
            />
          ))}
        </div>
      )}

      {status ? <p className="model-status" role="status">{status}</p> : null}

      {dialog ? (
        <AddModelDialog
          mode={dialog.mode}
          provider={dialog.mode === "edit" ? dialog.provider : null}
          takenIds={providers.map((provider) => provider.provider_id)}
          keySource={keySourceFor(dialog.mode === "edit" ? dialog.provider : null, secretStatus)}
          envKeyName={dialog.mode === "edit" ? dialog.provider.env_key_name : ""}
          locale={locale}
          onClose={() => setDialog(null)}
          onDone={async (message) => {
            setDialog(null);
            setStatus(message);
            await onChanged();
          }}
        />
      ) : null}

      {pendingDelete ? (
        <ConfirmDialog
          title={pendingDelete.kind === "config" ? copy.deleteConfigTitle : copy.deleteTitle}
          body={confirmBody(pendingDelete, copy, locale)}
          confirmLabel={copy.confirmDelete}
          cancelLabel={copy.cancel}
          danger
          onConfirm={() => void deletePending(pendingDelete)}
          onCancel={() => setPendingDelete(null)}
        />
      ) : null}
    </div>
  );
}

function ConfigGroup({
  group,
  copy,
  locale,
  collapsed,
  keyBadge,
  openMenu,
  onMenu,
  onToggleCollapsed,
  onEdit,
  onDeleteConfig,
  onToggleModel,
  onDeleteModel,
}: {
  group: ModelGroup;
  copy: ModelsCopy;
  locale: Locale;
  collapsed: boolean;
  keyBadge: ReactNode;
  openMenu: string | null;
  onMenu: (key: string) => void;
  onToggleCollapsed: () => void;
  onEdit: () => void;
  onDeleteConfig: () => void;
  onToggleModel: (row: ModelRow) => void;
  onDeleteModel: (row: ModelRow) => void;
}) {
  const menuKey = `config:${group.provider.provider_id}`;

  return (
    <section className="model-group">
      <div className="model-group-head">
        <button
          type="button"
          className="model-group-toggle"
          aria-expanded={!collapsed}
          aria-label={collapsed ? copy.expandConfig : copy.collapseConfig}
          onClick={onToggleCollapsed}
        >
          <ChevronDown
            size={15}
            aria-hidden="true"
            className={`model-group-caret${collapsed ? " model-group-caret-closed" : ""}`}
          />
          <ProfileIcon provider={group.provider} size={28} className="model-row-icon" />
          <span className="model-group-name">{configName(group.provider, locale)}</span>
          <span className="model-group-count">{copy.count(group.rows.length)}</span>
          {keyBadge}
        </button>
        <div className="model-row-menu">
          <button
            type="button"
            className="icon-button model-menu-trigger"
            aria-haspopup="menu"
            aria-expanded={openMenu === menuKey}
            aria-label={copy.menu}
            onClick={(event) => {
              event.stopPropagation();
              onMenu(menuKey);
            }}
          >
            <MoreHorizontal size={16} aria-hidden="true" />
          </button>
          {openMenu === menuKey ? (
            <div className="model-menu" role="menu" onClick={(event) => event.stopPropagation()}>
              <MenuItem icon={<Pencil size={14} aria-hidden="true" />} label={copy.editConfig} onClick={onEdit} />
              <MenuItem
                icon={<Trash2 size={14} aria-hidden="true" />}
                label={copy.deleteConfig}
                danger
                onClick={onDeleteConfig}
              />
            </div>
          ) : null}
        </div>
      </div>

      {collapsed ? null : (
        <ul className="model-list">
          {group.rows.map((row) => (
            <li key={row.key} className={`model-row${row.model.enabled ? "" : " model-row-off"}`}>
              <div className="model-row-main">
                <div className="model-row-name">{modelName(row.model)}</div>
                <div className="model-row-meta">
                  <span>{rowSubtitle(row.provider, locale)}</span>
                  {row.model.enabled ? null : <span className="model-row-tag">{copy.disabledTag}</span>}
                </div>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={row.model.enabled}
                aria-label={row.model.enabled ? copy.disable : copy.enable}
                className={`model-switch${row.model.enabled ? " model-switch-on" : ""}`}
                onClick={() => onToggleModel(row)}
              >
                <span className="model-switch-knob" />
              </button>
              <div className="model-row-menu">
                <button
                  type="button"
                  className="icon-button model-menu-trigger"
                  aria-haspopup="menu"
                  aria-expanded={openMenu === row.key}
                  aria-label={copy.menu}
                  onClick={(event) => {
                    event.stopPropagation();
                    onMenu(row.key);
                  }}
                >
                  <MoreHorizontal size={16} aria-hidden="true" />
                </button>
                {openMenu === row.key ? (
                  <div className="model-menu" role="menu" onClick={(event) => event.stopPropagation()}>
                    <MenuItem
                      icon={<Pencil size={14} aria-hidden="true" />}
                      label={copy.edit}
                      onClick={onEdit}
                    />
                    <MenuItem
                      icon={<Trash2 size={14} aria-hidden="true" />}
                      label={copy.delete}
                      danger
                      onClick={() => onDeleteModel(row)}
                    />
                  </div>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function MenuItem({
  icon,
  label,
  danger,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  danger?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      className={`model-menu-item${danger ? " model-menu-item-danger" : ""}`}
      onClick={onClick}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}

function confirmBody(pending: PendingDelete, copy: ModelsCopy, locale: Locale): string {
  if (pending.kind === "config") {
    return copy.deleteConfigBody(
      configName(pending.group.provider, locale),
      pending.group.rows.length
    );
  }
  const row = pending.row;
  return row.provider.models.length <= 1
    ? copy.deleteLastModel(configName(row.provider, locale))
    : copy.deleteBody(modelName(row.model));
}

function keyBadge(
  status: ProviderSecretStatus | undefined,
  envKeyName: string,
  copy: ModelsCopy
): ReactNode {
  if (status?.configured) return null;
  if (status?.env_configured) {
    return <span className="model-row-tag">{copy.keyFromEnv(envKeyName)}</span>;
  }
  return <span className="model-row-warn">{copy.keyMissing}</span>;
}

/** Which key the endpoint would fall back to when the field is left empty. */
function keySourceFor(
  provider: ProviderProfile | null,
  secretStatus: Record<string, ProviderSecretStatus>
): KeySource {
  if (!provider) return "none";
  const status = secretStatus[provider.provider_id];
  if (status?.configured) return "saved";
  return status?.env_configured ? "env" : "none";
}
