import type { Schema } from "../../data/resource";
import {
  BedrockRuntimeClient,
  ConverseCommand,
  type ConverseCommandInput,
  type Message,
} from "@aws-sdk/client-bedrock-runtime";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  PutCommand,
  UpdateCommand,
  QueryCommand,
} from "@aws-sdk/lib-dynamodb";

const CONVERSATION_TABLE = process.env.CONVERSATION_TABLE_NAME;
const MESSAGE_TABLE = process.env.MESSAGE_TABLE_NAME;

const MAX_TITLE_LENGTH = 20;
const SYSTEMPROMPT = "You are the best teacher in the world.";
const GENERIC_ERROR_MESSAGE =
  "申し訳ございません。サーバーで予期せぬエラーが発生しました。";
const MAX_CONVERSATION_HISTORY = 20;

const client = new BedrockRuntimeClient();
const dynamoClient = new DynamoDBClient();
const docClient = DynamoDBDocumentClient.from(dynamoClient);

export const handler: Schema["BedrockChat"]["functionHandler"] = async (
  event,
) => {
  const prompt = event.arguments.prompt;
  const modelId = event.arguments.modelId;
  const conversationId = event.arguments.conversationId;

  const claims =
    event.identity && "claims" in event.identity ? event.identity.claims : null;
  const sub = claims?.sub;
  const username = claims?.username ?? claims?.["cognito:username"];
  const owner = sub && username ? `${sub}::${username}` : "unknown-user";

  try {
    const title =
      prompt.length > MAX_TITLE_LENGTH
        ? prompt.substring(0, MAX_TITLE_LENGTH)
        : prompt;
    if (conversationId) {
      await saveConversation(conversationId, title, owner);
      await saveMessage(conversationId, "user", prompt, owner);
    }
    let conversationHistory: Message[] = [];
    if (conversationId) {
      conversationHistory = await getConversationHistory(conversationId);
    }

    const assistantResponse = await invokeBedrockModel(
      prompt,
      modelId,
      conversationHistory,
    );

    if (conversationId) {
      await saveMessage(conversationId, "assistant", assistantResponse, owner);
    }

    return assistantResponse;
  } catch (error) {
    console.error("処理中にエラーが発生しました:", error);
    throw new Error(GENERIC_ERROR_MESSAGE);
  }
};

async function invokeBedrockModel(
  prompt: string,
  modelId: string,
  conversationHistory: Message[] = [],
): Promise<string> {
  const messages = [
    ...conversationHistory,
    {
      role: "user" as const,
      content: [{ text: prompt }],
    },
  ];
  const input: ConverseCommandInput = {
    modelId: modelId,
    system: [{ text: SYSTEMPROMPT }],
    messages: messages,
    inferenceConfig: {
      maxTokens: 1000,
      temperature: 0.5,
    },
  };

  const command = new ConverseCommand(input);
  const response = await client.send(command);
  return response.output?.message?.content?.[0]?.text || "";
}

async function saveConversation(
  conversationId: string,
  title: string,
  owner: string,
) {
  try {
    const timestamp = getISOString();
    const updateCommand = new UpdateCommand({
      TableName: CONVERSATION_TABLE,
      Key: { conversationId: conversationId },
      UpdateExpression: `
      SET #title = if_not_exists(#title, :title),
        #createdAt = if_not_exists(#createdAt, :timestamp),
        #updatedAt = :timestamp,
        #owner = if_not_exists(#owner, :owner),
        #typename = if_not_exists(#typename, :typename)
      `,
      ExpressionAttributeNames: {
        "#title": "title",
        "#createdAt": "createdAt",
        "#updatedAt": "updatedAt",
        "#owner": "owner",
        "#typename": "__typename",
      },
      ExpressionAttributeValues: {
        ":title": title,
        ":timestamp": timestamp,
        ":owner": owner,
        ":typename": "Conversation",
      },
    });
    await docClient.send(updateCommand);
  } catch (error) {
    console.error("会話の保存でエラーが発生しました:", error);
    throw new Error(GENERIC_ERROR_MESSAGE);
  }
}

async function saveMessage(
  conversationId: string,
  sender: string,
  content: string,
  owner: string,
) {
  const timestamp = getISOString();
  try {
    const putCommand = new PutCommand({
      TableName: MESSAGE_TABLE,
      Item: {
        conversationId: conversationId,
        createdAt: timestamp,
        sender: sender,
        content: content,
        owner: owner,
        __typename: "Message",
      },
    });
    await docClient.send(putCommand);
  } catch (error) {
    console.error("メッセージの保存でエラーが発生しました:", error);
    throw new Error(GENERIC_ERROR_MESSAGE);
  }
}

function getISOString(): string {
  return new Date().toISOString();
}

async function getConversationHistory(
  conversationId: string,
): Promise<Message[]> {
  try {
    const queryCommand = new QueryCommand({
      TableName: MESSAGE_TABLE,
      KeyConditionExpression: "conversationId = :conversationId",
      ExpressionAttributeValues: {
        ":conversationId": conversationId,
      },
      ScanIndexForward: false,
      Limit: MAX_CONVERSATION_HISTORY,
    });
    const result = await docClient.send(queryCommand);
    if (!result.Items) return [];
    return result.Items.map((item) => ({
      role: item.sender,
      content: [{ text: item.content || "" }],
    })).reverse();
  } catch (error) {
    console.error("会話履歴の取得に失敗しました:", error);
    return [];
  }
}
