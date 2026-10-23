// Preloaded into every benchmark server: reports the process's CPU time when asked.
process.on('message', (message) => {
  if (message === 'cpu') process.send?.({ cpu: process.cpuUsage() });
});
