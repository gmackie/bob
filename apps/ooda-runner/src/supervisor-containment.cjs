"use strict";

function containSupervisorCommand(config, options = {}) {
  const platform = options.platform || process.platform;
  const nodeEnv = options.nodeEnv || process.env.NODE_ENV || "development";
  if (platform !== "linux" || nodeEnv !== "production") return config;

  const sandboxBinary = options.sandboxBinary || "/usr/bin/bwrap";
  return {
    binary: sandboxBinary,
    cwd: config.cwd,
    args: [
      "--die-with-parent",
      "--new-session",
      "--unshare-user",
      "--unshare-pid",
      "--unshare-ipc",
      "--unshare-uts",
      "--cap-drop",
      "ALL",
      "--bind",
      "/",
      "/",
      "--proc",
      "/proc",
      "--dev-bind",
      "/dev",
      "/dev",
      "--chdir",
      config.cwd,
      "--",
      config.binary,
      ...config.args,
    ],
  };
}

module.exports = { containSupervisorCommand };
