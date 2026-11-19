import * as React from 'react'
import { createPortal } from 'react-dom'
import { rateReply } from '../../services/chat/store.js'
import { copyText } from '../../utils/clipboard.js'

export const { Surface, Tool } = window.createMobileMessageActions(React, createPortal, copyText, rateReply)
