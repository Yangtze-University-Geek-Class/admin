<script setup lang="ts">
import { TxCard } from "@talex-touch/tuffex/card";
import { TxStatusBadge } from "@talex-touch/tuffex/status-badge";
import { TxTag } from "@talex-touch/tuffex/tag";
import { TxEmptyState } from "@talex-touch/tuffex/empty-state";
import { TxAlert } from "@talex-touch/tuffex/alert";
import PageHeader from "../../components/PageHeader.vue";
import ErrorPanel from "../../components/ErrorPanel.vue";
import LoadingBlock from "../../components/LoadingBlock.vue";
import { api } from "../../lib/http";
import { useOrg } from "../../lib/github";
import { useResource } from "../../lib/resource";

type Alert = { number: number; security_advisory?: { severity?: string; summary?: string }; repository?: { full_name?: string }; dependency?: { package?: { name?: string } } };
type Feature = { supported: boolean; reason: string | null; error?: string | null };
type SecurityResponse = { plan: string; two_factor_required: boolean; dependabot: Feature & { alerts: Alert[] }; secret_scanning: Feature; audit_log: Feature };

const { apiBase } = useOrg();
const security = useResource(() => api<SecurityResponse>(`${apiBase.value}/security`), [apiBase]);
const SEVERITY: Record<string, string> = { critical: "严重", high: "高", medium: "中", low: "低" };
const severityStatus = (s?: string) => (s === "critical" || s === "high" ? "danger" : s === "medium" ? "warning" : "info");
</script>

<template>
  <div class="page">
    <PageHeader title="安全" description="依赖漏洞提醒、密钥扫描与审计日志的开通情况。能不能用取决于 GitHub 组织的方案。" />
    <ErrorPanel v-if="security.error.value" :error="security.error.value" :retry="security.reload" />
    <LoadingBlock v-else-if="!security.data.value" :lines="6" />
    <template v-else>
      <TxCard>
        <dl class="facts">
          <dt>方案</dt><dd class="mono">{{ security.data.value.plan }}</dd>
          <dt>两步验证</dt>
          <dd><TxStatusBadge :text="security.data.value.two_factor_required ? '所有成员必须开启' : '不强制'" :status="security.data.value.two_factor_required ? 'success' : 'warning'" size="sm" /></dd>
        </dl>
      </TxCard>

      <TxCard>
        <template #header>
          <div class="card-head">
            <h2 class="section-title">依赖漏洞提醒（Dependabot）</h2>
            <TxStatusBadge :text="security.data.value.dependabot.supported ? '可用' : '不可用'" :status="security.data.value.dependabot.supported ? 'success' : 'muted'" size="sm" />
          </div>
        </template>
        <p v-if="!security.data.value.dependabot.supported" class="muted">{{ security.data.value.dependabot.reason }}</p>
        <template v-else>
          <TxAlert v-if="security.data.value.dependabot.error" type="warning" :message="security.data.value.dependabot.error" :closable="false" />
          <TxEmptyState v-if="!security.data.value.dependabot.alerts.length" title="没有未处理的漏洞提醒" size="small" />
          <ul v-else class="alerts">
            <li v-for="alert in security.data.value.dependabot.alerts" :key="alert.number">
              <TxStatusBadge :text="SEVERITY[alert.security_advisory?.severity ?? ''] ?? '未知'" :status="severityStatus(alert.security_advisory?.severity)" size="sm" />
              <span class="cell-stack">
                <span>{{ alert.security_advisory?.summary }}</span>
                <span class="cell-sub"><span class="mono">{{ alert.repository?.full_name }}</span> · <span class="mono">{{ alert.dependency?.package?.name }}</span></span>
              </span>
            </li>
          </ul>
        </template>
      </TxCard>

      <div class="grid-2">
        <TxCard v-for="item in [{ title: '密钥扫描', feature: security.data.value.secret_scanning }, { title: '组织审计日志', feature: security.data.value.audit_log }]" :key="item.title">
          <template #header>
            <div class="card-head">
              <h2 class="section-title">{{ item.title }}</h2>
              <TxTag :label="item.feature.supported ? '可用' : '不可用'" size="sm" variant="plain" />
            </div>
          </template>
          <p class="muted">{{ item.feature.supported ? "已开通。" : item.feature.reason }}</p>
        </TxCard>
      </div>
    </template>
  </div>
</template>

<style scoped>
.alerts {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.alerts li {
  display: flex;
  align-items: flex-start;
  gap: 10px;
}
p {
  margin: 0;
}
</style>
