/** `node --import jskelet/register` ile alias hook'unu kaydeder. */
import { register } from "node:module";

register("./alias-hooks.mjs", import.meta.url);
