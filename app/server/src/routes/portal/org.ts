import type { FastifyInstance } from "fastify";
import { TITLES, TITLE_IDS, TONES } from "../../lib/roles.js";

/**
 * 公开的组织架构：称号与部门的显示信息（名字、标签、图标、色调、说明、层级），给官网「组织架构」窗口和论坛称号用。
 * 称号和部门都由提督在控制台改，这里读数据库，前端不另写一份。不含权限包、不含任何人。
 * `tones` 是色调 id 到浅色主题色值的对照（调色板本身固定在代码里，提督只挑用哪个）。
 */
export default async function portalOrgRoutes(app: FastifyInstance) {
  const { roles } = app.services;
  app.get("/api/public/org", async () => {
    const titles = roles.titleConfigs();
    return {
      tones: TONES,
      titles: TITLE_IDS.map(id => {
        const { label, tag, icon, tone, description } = titles[id];
        return { id, label, tag, icon, tone, description, rank: TITLES[id].rank };
      }),
      departments: roles.listDepartments().filter(item => !item.archived)
        .map(({ id, name, tag, icon, tone, description }) => ({ id, name, tag, icon, tone, description })),
    };
  });
}
