import axios from "axios"
import logger from "./logger"

class Slack {
    public static async SendMessage(message: string) {
        const url = process.env.SLACK_WEBHOOK_URL
        if (!url) {
            logger.error('Slack Url Not Set')
            return
        }
        const headers = { "Content-Type": "application/json" }
        const reqBody = {
            text: message
        }
        try {
            await axios.post(url, reqBody, { headers })
        } catch (err) {
            console.log(err)
        }
    }
}
export default Slack