"""Service logging. PyMongo's debug logging writes whole database commands — CV text, profiles,
cached LLM outputs — so its loggers are pinned to WARNING even if the root level is lowered."""

import logging

QUIET_LOGGERS = ("pymongo", "pymongo.command", "pymongo.connection", "pymongo.serverSelection", "pymongo.topology")


def configure_logging(level: int = logging.INFO) -> None:
    logging.basicConfig(level=level, format="%(asctime)s - %(name)s - %(levelname)s - %(message)s")
    for name in QUIET_LOGGERS:
        logging.getLogger(name).setLevel(logging.WARNING)
