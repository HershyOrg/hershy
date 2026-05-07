from __future__ import annotations

import asyncio
from dataclasses import dataclass
from typing import Any


@dataclass
class Event:
    type: str
    payload: Any


class EventBus:
    def __init__(self, maxsize: int = 10_000) -> None:
        self._queue: asyncio.Queue[Event] = asyncio.Queue(maxsize=maxsize)

    async def publish(self, event: Event) -> None:
        await self._queue.put(event)

    async def next(self) -> Event:
        return await self._queue.get()

