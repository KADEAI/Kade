import { Tab, TabContent } from "../../common/Tab"
import KiloCodeAuth from "../common/KiloCodeAuth"

const WelcomeView = () => {
	return (
		<Tab>
			<TabContent className="flex flex-col gap-5">
				<div className="bg-vscode-sideBar-background p-4">
					<KiloCodeAuth welcomeMode />
				</div>
			</TabContent>
		</Tab>
	)
}

export default WelcomeView
