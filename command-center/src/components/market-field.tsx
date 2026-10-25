import { Field } from "./ui";

// Only shown once there is more than one market; otherwise records go to the single market.
export function MarketField({ markets, value }: { markets: { id: string; name: string }[]; value?: string }) {
  if (markets.length <= 1) return <input type="hidden" name="market_id" value={markets[0]?.id ?? ""} />;
  return (
    <Field label="Market" name="market_id">
      <select id="market_id" name="market_id" defaultValue={value ?? markets[0].id} className="field">
        {markets.map((m) => (
          <option key={m.id} value={m.id}>
            {m.name}
          </option>
        ))}
      </select>
    </Field>
  );
}
