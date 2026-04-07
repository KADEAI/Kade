export const createSendRequestGate = () => {
  let locked = false;

  return {
    requestSend(onSend: () => void) {
      if (locked) {
        return false;
      }

      locked = true;

      try {
        onSend();
        return true;
      } finally {
        window.setTimeout(() => {
          locked = false;
        }, 0);
      }
    },
  };
};
