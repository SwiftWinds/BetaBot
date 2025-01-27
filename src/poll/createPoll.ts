import { Client, User, TextChannel, Message, MessageReaction } from "discord.js"
import { ActionMessage, MessageReactionEventType } from "../actionMessage"
import { Firestore, Timestamp } from "firebase-admin/firestore"

import ShortUniqueID from "short-unique-id"
const uid = new ShortUniqueID({ length: 10 })

import {
  PollConfiguration, PollQuestion,
  pollsData,
  getEmoji, getEmoteName,
  pollsCollectionID
} from "./sharedPoll"

import { BotCommand } from "../botCommand"

class SelectedPollField
{
  poll: string
  question?: string
  option?: string

  user: string
  channel: string

  type: SelectedPollFieldType
}

enum SelectedPollFieldType
{
  none,
  option,
  questionPrompt,
  questionRoles,
  questionDelete,
  questionInfo,
  pollName,
  pollOpenTime,
  pollCloseTime,
  pollVoteMessage,
  pollSaveChanges,
  pollCloseEditing
}

enum PollQuestionEditType
{
  prompt = 1,
  roles = 2,
  delete = 3,
  info = 4
}

const pollQuestionEditEmotes = {
  "🖊": PollQuestionEditType.prompt,
  "👤": PollQuestionEditType.roles,
  "🗑": PollQuestionEditType.delete,
  "ℹ️": PollQuestionEditType.info
}

enum PollEditType
{
  title = 1,
  newQuestion = 2,
  openTime = 3,
  closeTime = 4,
  voteMessage = 5,
  saveChanges = 6,
  closeEditing = 7
}

const pollEditEmotes = {
  "🖊": PollEditType.title,
  "🆕": PollEditType.newQuestion,
  "📖": PollEditType.openTime,
  "📕": PollEditType.closeTime,
  "📣": PollEditType.voteMessage,
  "☑️": PollEditType.saveChanges,
  "❌": PollEditType.closeEditing
}

var pollEditActionMessages: { [k: string]: { [k: string]: ActionMessage<PollQuestion> } } = {}
var pollEditSelectedFields: { [k: string]: SelectedPollField } = {}

const titleMessageID = "title"

export function getCreatePollCommand(): BotCommand
{
  return BotCommand.fromRegex(
    "createpoll", "create a new poll",
    /^createpoll\s+(\w+)(?:\s+(.+))?$/, /^createpoll(\s+.*)?$/,
    "createpoll <id> [name]",
    async (commandArguments: string[], message: Message, client: Client) => {
      let pollID = commandArguments[1]
      let pollName = commandArguments[2]

      let pollData = pollsData[pollID] ?? {active: false, id: pollID, name: pollName ?? pollID, questions: [], pollType: "dm", openTime: Timestamp.fromDate(new Date()), closeTime: Timestamp.fromDate(new Date())} as PollConfiguration
      pollsData[pollID] = pollData

      sendPollEditMessages(pollData, message.channel as TextChannel, client)
    }
  )
}

async function sendPollEditMessages(pollConfig: PollConfiguration, channel: TextChannel, client: Client)
{
  if (!pollEditActionMessages[pollConfig.id])
  {
    pollEditActionMessages[pollConfig.id] = {}
  }

  if (!pollEditActionMessages[pollConfig.id][titleMessageID])
  {
    let titleActionMessage = new ActionMessage(channel, null, null,
      async () => {
        let editingPollTitle: boolean
        let editingOpenTime: boolean
        let editingCloseTime: boolean
        let editingVoteMessage: boolean
        if (pollEditSelectedFields[pollConfig.id])
        {
          editingPollTitle = pollEditSelectedFields[pollConfig.id].type == SelectedPollFieldType.pollName
          editingOpenTime = pollEditSelectedFields[pollConfig.id].type == SelectedPollFieldType.pollOpenTime
          editingCloseTime = pollEditSelectedFields[pollConfig.id].type == SelectedPollFieldType.pollCloseTime
          editingVoteMessage = pollEditSelectedFields[pollConfig.id].type == SelectedPollFieldType.pollVoteMessage
        }

        let titleString = (editingPollTitle ? "*" : "") + "__**" + pollConfig.name + "**__" + (editingPollTitle ? "*" : "")
        if (editingOpenTime)
        {
          titleString += "  (<t:" + pollsData[pollConfig.id].openTime.seconds.toString() + ":f>)"
        }
        if (editingCloseTime)
        {
          titleString += "  (<t:" + pollsData[pollConfig.id].closeTime.seconds.toString() + ":f>)"
        }
        if (editingVoteMessage)
        {
          titleString += pollsData[pollConfig.id].voteMessageSettings ? "  (<#" + pollsData[pollConfig.id].voteMessageSettings.channelID + "> " + pollsData[pollConfig.id].voteMessageSettings.messageText + ")" : "  (None)"
        }

        return titleString
      }, async (message: Message) => {
        await message.react("🖊")
        await message.react("🆕")
        await message.react("📖")
        await message.react("📕")
        await message.react("📣")
        await message.react("☑️")
        await message.react("❌")
      },
      (reaction: MessageReaction, user: User, reactionEventType: MessageReactionEventType) => {
        handlePollEditReaction(client, reaction, user, reactionEventType, null, pollConfig.id)
      }
    )

    titleActionMessage.initActionMessage()
    pollEditActionMessages[pollConfig.id][titleMessageID] = titleActionMessage
  }

  for (let pollQuestion of pollConfig.questions)
  {
    if (!pollEditActionMessages[pollConfig.id][pollQuestion.id])
    {
      let questionActionMessage = new ActionMessage<PollQuestion>(channel, null, pollQuestion,
        async (questionData: PollQuestion) => {
          let selectedOption: string
          let editingQuestionPrompt: boolean
          let whitelistedRoleIDs: string
          let deletingQuestion: boolean
          let showingQuestionInfo: boolean

          if (pollEditSelectedFields[pollConfig.id] && pollEditSelectedFields[pollConfig.id].question == questionData.id)
          {
             selectedOption = pollEditSelectedFields[pollConfig.id].type == SelectedPollFieldType.option ? pollEditSelectedFields[pollConfig.id].option : null
             editingQuestionPrompt = pollEditSelectedFields[pollConfig.id].type == SelectedPollFieldType.questionPrompt
             whitelistedRoleIDs = pollEditSelectedFields[pollConfig.id].type == SelectedPollFieldType.questionRoles ? (questionData.roleIDs ?? []).reduce((rolesString, roleID) => rolesString += "<@&" + roleID + "> ", "") : null
             deletingQuestion = pollEditSelectedFields[pollConfig.id].type == SelectedPollFieldType.questionDelete
             showingQuestionInfo = pollEditSelectedFields[pollConfig.id].type == SelectedPollFieldType.questionInfo
          }

          let questionString = (deletingQuestion ? "*" : "") + (editingQuestionPrompt ? "*" : "") + "**" + questionData.prompt + "**" + (editingQuestionPrompt ? "*" : "")
            + (whitelistedRoleIDs != null ? "  (" + (whitelistedRoleIDs == "" ? "@everyone" : whitelistedRoleIDs.slice(0, -1)) + ")" : "")
            + (showingQuestionInfo ? "  *(" + questionData.id + ")*" : "")
          for (let optionData of questionData.options ?? [])
          {
            questionString += "\n" + ":" + optionData.emote + ": \\: " + (selectedOption == optionData.id ? "*" : "") + optionData.name + (selectedOption == optionData.id ? "*" : "")
              + (showingQuestionInfo ? "  *(" + optionData.id + ")*" : "")
          }
          questionString += (deletingQuestion ? "*" : "")

          return questionString
        }, async (message: Message, questionData: PollQuestion) => {
          await message.react("🖊")
          await message.react("👤")
          await message.react("🗑")
          await message.react("ℹ️")

          for (let optionData of questionData.options ?? [])
          {
            let emoji = getEmoji(client, optionData.emote)
            if (emoji == null) { continue }
            await message.react(emoji)
          }
        }, (reaction: MessageReaction, user: User, reactionEventType: MessageReactionEventType, questionData: PollQuestion) => {
          handlePollEditReaction(client, reaction, user, reactionEventType, questionData, pollConfig.id)
        }
      )

      questionActionMessage.initActionMessage()
      pollEditActionMessages[pollConfig.id][pollQuestion.id] = questionActionMessage
    }
  }
}

async function handlePollEditReaction(client: Client, reaction: MessageReaction, user: User, reactionEventType: MessageReactionEventType, questionData: PollQuestion, currentPollID: string)
{
  if (user.id == client.user.id) { return }

  let currentOptionData = questionData ? questionData.options.find(optionData => {
    let emoteName = getEmoteName(reaction.emoji)
    return optionData.emote == emoteName
  }) : null
  let questionEditType = pollQuestionEditEmotes[reaction.emoji.toString()]
  let pollEditType = pollEditEmotes[reaction.emoji.toString()]

  if (!currentOptionData && !questionEditType && questionData)
  {
    currentOptionData = {emote: getEmoteName(reaction.emoji), id: uid(), name: "<<Enter name>>"}
    questionData.options.push(currentOptionData)
    reaction.message.react(reaction.emoji)
  }

  if (!questionData && !pollEditType)
  {
    reaction.users.remove(user)
    return
  }

  switch (reactionEventType)
  {
    case "added":
    if (!questionData && pollEditType)
    {
      pollEditSelectedFields[currentPollID] = {type: SelectedPollFieldType.none, poll: currentPollID, user: user.id, channel: reaction.message.channelId}

      switch (pollEditType)
      {
        case PollEditType.title:
        pollEditSelectedFields[currentPollID].type = SelectedPollFieldType.pollName
        break

        case PollEditType.newQuestion:
        let newQuestionData = {id: uid(), prompt: "<<Enter prompt>>", options: []}
        pollsData[currentPollID].questions.push(newQuestionData)
        reaction.users.remove(user)

        delete pollEditSelectedFields[currentPollID]
        // pollEditSelectedFields[currentPollID] = {type: SelectedPollFieldType.questionPrompt, poll: currentPollID, question: questionData.id, user: user.id, channel: reaction.message.channelId}

        sendPollEditMessages(pollsData[currentPollID], reaction.message.channel as TextChannel, client)
        break

        case PollEditType.openTime:
        pollEditSelectedFields[currentPollID].type = SelectedPollFieldType.pollOpenTime
        break

        case PollEditType.closeTime:
        pollEditSelectedFields[currentPollID].type = SelectedPollFieldType.pollCloseTime
        break

        case PollEditType.voteMessage:
        pollEditSelectedFields[currentPollID].type = SelectedPollFieldType.pollVoteMessage
        break

        case PollEditType.saveChanges:
        pollEditSelectedFields[currentPollID].type = SelectedPollFieldType.pollSaveChanges
        return

        case PollEditType.closeEditing:
        removePollActionMessages(currentPollID)
        break
      }
    }
    else if (questionData && questionEditType)
    {
      pollEditSelectedFields[currentPollID] = {type: SelectedPollFieldType.none, poll: currentPollID, question: questionData.id, user: user.id, channel: reaction.message.channelId}

      switch (questionEditType)
      {
        case PollQuestionEditType.prompt:
        pollEditSelectedFields[currentPollID].type = SelectedPollFieldType.questionPrompt
        break

        case PollQuestionEditType.roles:
        pollEditSelectedFields[currentPollID].type = SelectedPollFieldType.questionRoles
        break

        case PollQuestionEditType.delete:
        pollEditSelectedFields[currentPollID].type = SelectedPollFieldType.questionDelete
        break

        case PollQuestionEditType.info:
        pollEditSelectedFields[currentPollID].type = SelectedPollFieldType.questionInfo
        break
      }
    }
    else
    {
      pollEditSelectedFields[currentPollID] = {type: SelectedPollFieldType.option, poll: currentPollID, question: questionData.id, option: currentOptionData.id, user: user.id, channel: reaction.message.channelId}
    }

    break

    case "removed":
    if (pollEditSelectedFields[currentPollID] && (
      pollEditType == PollEditType.title && pollEditSelectedFields[currentPollID].type == SelectedPollFieldType.pollName
      || pollEditType == PollEditType.openTime && pollEditSelectedFields[currentPollID].type == SelectedPollFieldType.pollOpenTime
      || pollEditType == PollEditType.closeTime && pollEditSelectedFields[currentPollID].type == SelectedPollFieldType.pollCloseTime
      || pollEditType == PollEditType.voteMessage && pollEditSelectedFields[currentPollID].type == SelectedPollFieldType.pollVoteMessage
      || pollEditType == PollEditType.saveChanges && pollEditSelectedFields[currentPollID].type == SelectedPollFieldType.pollSaveChanges
      || questionData && pollEditSelectedFields[currentPollID].question == questionData.id && (
        currentOptionData && pollEditSelectedFields[currentPollID].type == SelectedPollFieldType.option && pollEditSelectedFields[currentPollID].option == currentOptionData.id
        || questionEditType == PollQuestionEditType.prompt && pollEditSelectedFields[currentPollID].type == SelectedPollFieldType.questionPrompt
        || questionEditType == PollQuestionEditType.roles && pollEditSelectedFields[currentPollID].type == SelectedPollFieldType.questionRoles
        || questionEditType == PollQuestionEditType.delete && pollEditSelectedFields[currentPollID].type == SelectedPollFieldType.questionDelete
        || questionEditType == PollQuestionEditType.info && pollEditSelectedFields[currentPollID].type == SelectedPollFieldType.questionInfo
      )
    ))
    {
      delete pollEditSelectedFields[currentPollID]
    }
    break
  }

  let actionMessage = questionData ? pollEditActionMessages[currentPollID][questionData.id] : pollEditActionMessages[currentPollID][titleMessageID]
  if (actionMessage)
  {
    await (actionMessage as ActionMessage<PollQuestion>).sendMessage()
  }

  cleanReactions(reaction, user, reactionEventType, Object.values(pollEditActionMessages[currentPollID]).map(actionMessage => actionMessage.liveMessage))
}

export function setupPollEditTextInputEventHandlers(client: Client, firestoreDB: Firestore)
{
  client.on('messageCreate', (message) => {
    for (let pollID in pollEditSelectedFields)
    {
      if (pollEditSelectedFields[pollID].channel == message.channel.id)
      {
        handlePollEditFieldTextInput(message, pollEditSelectedFields[pollID], firestoreDB)
      }
    }
  })
}

async function handlePollEditFieldTextInput(message: Message, pollField: SelectedPollField, firestoreDB: Firestore)
{
  switch (pollField.type)
  {
    case SelectedPollFieldType.option:
    pollsData[pollField.poll].questions.find(question => question.id == pollField.question).options.find(option => option.id == pollField.option).name = message.content
    break

    case SelectedPollFieldType.questionRoles:
    let questionRolesRegex = /^\s*((?:<@!?&?\d+>\s*)*)\s*$/

    if (questionRolesRegex.test(message.content))
    {
      let questionRolesString = questionRolesRegex.exec(message.content)[1]

      let roleIDs = []
      for (let roleIDString of questionRolesString.split(/\s+/))
      {
        let roleIDGroups = /<@!?&?(\d+)>/.exec(roleIDString)
        if (!roleIDGroups || roleIDGroups.length <= 1) { continue }

        roleIDs.push(roleIDGroups[1])
      }

      pollsData[pollField.poll].questions.find(question => question.id == pollField.question).roleIDs = roleIDs
    }
    break

    case SelectedPollFieldType.questionPrompt:
    pollsData[pollField.poll].questions.find(question => question.id == pollField.question).prompt = message.content
    break

    case SelectedPollFieldType.questionDelete:
    if (message.content == "y" || message.content == "confirm")
    {
      let questionIndex = pollsData[pollField.poll].questions.findIndex(question => question.id == pollField.question)
      questionIndex > -1 && pollsData[pollField.poll].questions.splice(questionIndex, 1)

      pollEditActionMessages[pollField.poll][pollField.question].removeActionMessage()
      message.delete()

      return
    }
    break

    case SelectedPollFieldType.pollName:
    pollsData[pollField.poll].name = message.content
    break

    case SelectedPollFieldType.pollOpenTime:
    case SelectedPollFieldType.pollCloseTime:
    let epochRegex = /^\s*(\d+)\s*$/
    let yyyyMMDDHHMMSSRegex = /^\s*(?:(\d{4})-)?(\d{2})-(\d{2})\s+(\d{2}):(\d{2})(?::(\d{2}))?\s*$/

    let selectedDate: Date

    if (epochRegex.test(message.content))
    {
      selectedDate = new Date(epochRegex.exec(message.content)[1])
    }
    else if (yyyyMMDDHHMMSSRegex.test(message.content))
    {
      let dateParts = yyyyMMDDHHMMSSRegex.exec(message.content)
      selectedDate = new Date()

      dateParts[1] && selectedDate.setFullYear(parseInt(dateParts[1]))
      selectedDate.setMonth(parseInt(dateParts[2])-1)
      selectedDate.setDate(parseInt(dateParts[3]))
      selectedDate.setHours(parseInt(dateParts[4]))
      selectedDate.setMinutes(parseInt(dateParts[5]))
      selectedDate.setSeconds(dateParts[6] ? parseInt(dateParts[6]) : 0)
    }

    if (selectedDate)
    {
      let selectedTimestamp = Timestamp.fromMillis(selectedDate.getTime())

      switch (pollField.type)
      {
        case SelectedPollFieldType.pollOpenTime:
        pollsData[pollField.poll].openTime = selectedTimestamp
        break

        case SelectedPollFieldType.pollCloseTime:
        pollsData[pollField.poll].closeTime = selectedTimestamp
        break
      }
      break
    }

    case SelectedPollFieldType.pollVoteMessage:
    let channelMessageRegex = /^\s*(?:(?:<#)?(\d+)(?:>)?)?\s+(.+)\s*$/

    if (channelMessageRegex.test(message.content))
    {
      let channelMessageParts = channelMessageRegex.exec(message.content)
      let channelID = channelMessageParts[1]
      let voteMessage = channelMessageParts[2]

      pollsData[pollField.poll].voteMessageSettings = {channelID: channelID, messageText: voteMessage}
    }
    break

    case SelectedPollFieldType.pollSaveChanges:
    if (message.content == "y" || message.content == "confirm")
    {
      removePollActionMessages(pollField.poll)
      message.delete()

      firestoreDB.doc(pollsCollectionID + "/" + pollField.poll).set(pollsData[pollField.poll], {merge: false})

      return
    }
    break
  }

  pollField.question && pollEditActionMessages[pollField.poll][pollField.question].sendMessage()
  !pollField.question && pollEditActionMessages[pollField.poll][titleMessageID].sendMessage()
  message.delete()
}

async function cleanReactions(reaction: MessageReaction, user: User, reactionEventType: MessageReactionEventType, otherMessages: Message[])
{
  if (reactionEventType == "added")
  {
    // await reaction.message.fetch()

    reaction.message.reactions.cache.forEach(otherReaction => {
      if (otherReaction.emoji.name == reaction.emoji.name) { return }

      // await otherReaction.users.fetch()
      if (otherReaction.users.cache.has(user.id))
      {
        otherReaction.users.remove(user.id)
      }
    })

    otherMessages.forEach(message => {
      if (!reaction.message || !message || message.id == reaction.message.id) { return }

      message.reactions.cache.forEach(reaction => {
        if (reaction.users.cache.has(user.id))
        {
          reaction.users.remove(user.id)
        }
      })
    })
  }
}

function removePollActionMessages(pollID: string)
{
  Object.keys(pollEditActionMessages[pollID]).forEach(async questionID => {
    await pollEditActionMessages[pollID][questionID].removeActionMessage()
    delete pollEditActionMessages[pollID][questionID]
  })

  delete pollEditSelectedFields[pollID]
}
