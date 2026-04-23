import fetch from 'node-fetch'

const BASE_URL = 'http://localhost:3000'

// Simulate a complete flow with logging
async function testCompleteFlow() {
  console.log('\n=== Testing Complete Intelligent Document Flow ===\n')

  // Test 1: REPROCANN with both sides (should not need dorso)
  console.log('TEST 1: Single REPROCANN image with both sides')
  console.log('Expected: detectImage returns ambosSides=true, extracts data, asks for DNI if complete')
  const test1 = {
    typeWebhook: 'incomingMessageReceived',
    messageData: {
      typeMessage: 'imageMessage',
      downloadUrl: 'https://images.unsplash.com/photo-1607623814075-e51df1bdc82f?w=400',
      idMessage: 'test1_msg',
    },
    senderData: {
      chatId: '595491111111@c.us',
      senderName: 'TestUser_BothSides',
    },
  }

  try {
    const res = await fetch(`${BASE_URL}/webhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(test1),
    })
    console.log(`✓ Webhook accepted (status: ${res.status})\n`)
  } catch (e) {
    console.log(`✗ Error: ${e.message}\n`)
  }

  // Wait for Claude Vision processing
  console.log('Waiting 3 seconds for Claude Vision processing...')
  await new Promise(r => setTimeout(r, 3000))

  // Test 2: Two-image REPROCANN - Frente first
  console.log('\nTEST 2: REPROCANN frente only')
  console.log('Expected: detectImage returns ambosSides=false, saves URL, asks for dorso, state="esperando_reprocann_dorso"\n')
  const test2 = {
    typeWebhook: 'incomingMessageReceived',
    messageData: {
      typeMessage: 'imageMessage',
      downloadUrl: 'https://images.unsplash.com/photo-1580489944761-b8f8dd006eca?w=400',
      idMessage: 'test2a_msg',
    },
    senderData: {
      chatId: '595491222222@c.us',
      senderName: 'TestUser_TwoImages',
    },
  }

  try {
    const res = await fetch(`${BASE_URL}/webhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(test2),
    })
    console.log(`✓ Frente image accepted (status: ${res.status})`)
  } catch (e) {
    console.log(`✗ Error: ${e.message}`)
  }

  console.log('Waiting 3 seconds...')
  await new Promise(r => setTimeout(r, 3000))

  // Test 2b: Send dorso
  console.log('\nTEST 2b: REPROCANN dorso (second image)')
  console.log('Expected: detectImage returns ambosSides=false, combines with saved frente, asks for DNI or missing fields\n')
  const test2b = {
    typeWebhook: 'incomingMessageReceived',
    messageData: {
      typeMessage: 'imageMessage',
      downloadUrl: 'https://images.unsplash.com/photo-1506905925346-21bda4d32df4?w=400',
      idMessage: 'test2b_msg',
    },
    senderData: {
      chatId: '595491222222@c.us',
      senderName: 'TestUser_TwoImages',
    },
  }

  try {
    const res = await fetch(`${BASE_URL}/webhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(test2b),
    })
    console.log(`✓ Dorso image accepted (status: ${res.status})`)
  } catch (e) {
    console.log(`✗ Error: ${e.message}`)
  }

  console.log('Waiting 3 seconds for processing...')
  await new Promise(r => setTimeout(r, 3000))

  // Test 3: Text message for field completion
  console.log('\nTEST 3: Text message response')
  console.log('Expected: If state="completando_datos", save response to collectedData, ask next field\n')
  const test3 = {
    typeWebhook: 'incomingMessageReceived',
    messageData: {
      typeMessage: 'textMessage',
      textMessageData: {
        textMessage: 'Buenos Aires',
      },
      idMessage: 'test3_msg',
    },
    senderData: {
      chatId: '595491333333@c.us',
      senderName: 'TestUser_Fields',
    },
  }

  try {
    const res = await fetch(`${BASE_URL}/webhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(test3),
    })
    console.log(`✓ Text message accepted (status: ${res.status})`)
  } catch (e) {
    console.log(`✗ Error: ${e.message}`)
  }

  console.log('Waiting 2 seconds...')
  await new Promise(r => setTimeout(r, 2000))

  // Test 4: DNI image
  console.log('\nTEST 4: DNI image (complete flow)')
  console.log('Expected: extractDocumentData extracts DNI, state="completado", email sent, confirm message to user\n')
  const test4 = {
    typeWebhook: 'incomingMessageReceived',
    messageData: {
      typeMessage: 'imageMessage',
      downloadUrl: 'https://images.unsplash.com/photo-1506905925346-21bda4d32df4?w=400',
      idMessage: 'test4_msg',
    },
    senderData: {
      chatId: '595491444444@c.us',
      senderName: 'TestUser_Complete',
    },
  }

  try {
    const res = await fetch(`${BASE_URL}/webhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(test4),
    })
    console.log(`✓ DNI image accepted (status: ${res.status})`)
  } catch (e) {
    console.log(`✗ Error: ${e.message}`)
  }

  console.log('Waiting 5 seconds for email processing...')
  await new Promise(r => setTimeout(r, 5000))

  console.log('\n=== Test Complete ===')
  console.log('Check server logs above for:')
  console.log('  ✓ detectImage() calls and results')
  console.log('  ✓ extractReprocannData() and extractDocumentData() calls')
  console.log('  ✓ State transitions (step changes)')
  console.log('  ✓ Email notification sent')
  console.log('  ✓ Any errors during processing')
}

testCompleteFlow().catch(e => console.error('Test error:', e.message))
