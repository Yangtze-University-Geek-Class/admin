// @vitest-environment jsdom
import { beforeAll, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { ConfirmProvider, useConfirm } from "../../web/shared/ui/ConfirmDialog";
import Select from "../../web/shared/ui/Select";
import NumberInput from "../../web/shared/ui/NumberInput";

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
it("keeps an empty numeric edit until blur instead of immediately forcing zero", async () => {
  function Example() { const [value, setValue] = useState(12); return <NumberInput value={value} onChange={setValue} min={1} max={100} />; }
  render(<Example />); const user = userEvent.setup(); const input = screen.getByRole("spinbutton") as HTMLInputElement;
  await user.clear(input); expect(input.value).toBe("");
  await user.type(input, "25"); expect(input.value).toBe("25");
  await user.tab(); expect(input.value).toBe("25");
});
