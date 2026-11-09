// Scripted fake model: replays a list of replies and records requests.
export function createFakeModel(replies = []) {
  const queue = [...replies];
  const requests = [];
  return {
    requests,
    async generate({ messages, tools } = {}) {
      requests.push({
        messages: JSON.parse(JSON.stringify(messages ?? [])),
        tools: JSON.parse(JSON.stringify(tools ?? [])),
      });
      if (queue.length === 0) return { text: 'done' };
      return queue.shift();
    },
  };
}

export default createFakeModel;
