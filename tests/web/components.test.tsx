// @vitest-environment jsdom
import { beforeAll, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ConfirmProvider, useConfirm } from "../../app/web/shared/ui/ConfirmDialog";
import Select from "../../app/web/shared/ui/Select";

beforeAll(() => {
  // jsdom does not implement the dialog top layer. Browser tests verify that behavior separately.
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute("open"); };
});
it("starts destructive confirmation on Cancel; Enter cannot trigger destruction", async () => {
  const done = vi.fn();
  function Example() { const confirm = useConfirm(); return <button onClick={async () => done(await confirm({ title: "删除测试", body: "不可恢复", variant: "danger" }))}>打开确认</button>; }
  render(<ConfirmProvider><Example /></ConfirmProvider>);
  const user = userEvent.setup();
  const trigger = screen.getByRole("button", { name: "打开确认" });
  await user.click(trigger);
  expect(screen.getByRole("alertdialog", { name: "删除测试" })).toBeTruthy();
  expect(document.activeElement).toBe(screen.getByRole("button", { name: "取消" }));
  await user.keyboard("{Enter}");
  await waitFor(() => expect(done).toHaveBeenCalledWith(false));
  expect(done).toHaveBeenCalledTimes(1);
  expect(document.activeElement).toBe(trigger);
});
it("uses one named accessible select and emits the selected value", async () => {
  const change = vi.fn(); render(<Select label="组织" value="a" onChange={change} options={[{ value: "a", label: "组织 A" }, { value: "b", label: "组织 B" }]} />);
  await userEvent.setup().selectOptions(screen.getByRole("combobox", { name: "组织" }), "b");
  expect(change).toHaveBeenCalledWith("b");
});
