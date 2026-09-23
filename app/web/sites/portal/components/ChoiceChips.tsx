// 单选按钮组，外观是一排小胶囊：选项只有几个时代替原生下拉框（意见箱的分类）。
// 用原生 <input type="radio">：方向键在组内切换、Tab 只停一次、读屏按单选组朗读，都是浏览器自带的行为。
export default function ChoiceChips({
  name,
  labelledBy,
  value,
  options,
  onChange,
}: {
  name: string;
  labelledBy: string;
  value: string;
  options: readonly string[];
  onChange: (value: string) => void;
}) {
  return (
    <div className="pt-choices" role="radiogroup" aria-labelledby={labelledBy}>
      {options.map((option) => (
        <label key={option} className="pt-choice">
          <input type="radio" name={name} value={option} checked={value === option} onChange={() => onChange(option)} />
          <span>{option}</span>
        </label>
      ))}
    </div>
  );
}
