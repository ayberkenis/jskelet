"use client";

import { useState } from "react";

export function Counter({ start = 0 }) {
  const [n, setN] = useState(start);
  return (
    <button type="button" onClick={() => setN((x) => x + 1)}>
      {n}
    </button>
  );
}
