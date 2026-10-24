"""File-backed agent memory.

The implementation is split across memory_store, memory_retrieval,
memory_dream and memory_utils; MemoryStore remains the public entry point.
"""

from .memory_store import MemoryStore
from .model_client import OpenAICompatibleClient

__all__ = ["MemoryStore", "OpenAICompatibleClient"]
