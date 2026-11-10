"use client";

import { useRef } from "react";
import { STAGE_LABEL } from "@/lib/format";
import { Constants } from "@/lib/database.types";
import { setStage } from "@/app/(app)/pipeline-actions";

// Changing the dropdown saves the new stage right away.
export function StageSelect({ id, stage }: { id: string; stage: string }) {
  const form = useRef<HTMLFormElement>(null);
  return (
    <form ref={form} action={setStage}>
      <input type="hidden" name="id" value={id} />
      <select
        name="stage"
        defaultValue={stage}
        onChange={() => form.current?.requestSubmit()}
        className="field w-auto py-1 pr-7 font-mono text-xs"
        aria-label="Stage"
      >
        {Constants.public.Enums.pipeline_stage.map((s) => (
          <option key={s} value={s}>
            {STAGE_LABEL[s]}
          </option>
        ))}
      </select>
    </form>
  );
}
