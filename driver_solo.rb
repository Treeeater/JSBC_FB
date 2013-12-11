#ruby driver of the AVC
#Prior to using, 1) gem install sys-proctable
#2) go to about:config of FF using the profile and type toolkit.startup.max_resumed_crashes in the search box. Set this value to -1/999999(very large number)

require 'sys/proctable'
include Sys

SLEEPTIME = 1500                #configurable: timeout.

RootDir = "D:/Research/JSBC/results"

def kill_process(pid)
	to_kill = Array.new
	to_kill.push(pid)
	ProcTable.ps do |proc|
		to_kill << proc.pid if to_kill.include?(proc.ppid)
	end
	Process.kill(9, *to_kill)
end

if (!Dir.exists?(RootDir)) then Dir.mkdir(RootDir) end
if (File.exists?("#{RootDir}/finished.txt")) 
	p "Job already finished?! Check your test set file."
	exit
end

pid = spawn "cfx run -p testProfile"

currentFileCount = Dir.entries(RootDir).length - 2                #. and .. doesn't count
previousFileCount = -1

while (true)
	if (File.exists?("#{RootDir}/finished.txt"))
		begin 
			kill_process(pid)
		rescue Errno::ESRCH
		end
		exit
	end
	currentFileCount = Dir.entries(RootDir).length - 2                #. and .. doesn't count
	if (previousFileCount != currentFileCount)
		previousFileCount = currentFileCount
	else
		begin
			kill_process(pid)
		rescue Errno::ESRCH
			#if we can't kill the process because the process already died, that's fine. We just want to restart the process.
		end
		sleep(10)                                                                        # wait for the child processes to close
		pid = spawn "cfx run -p testProfile"
	end
	sleep(SLEEPTIME)
end